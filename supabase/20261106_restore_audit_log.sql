-- หน้า Compare: บันทึก "เพิ่มเคสจากดิบ" ให้ตรวจสอบย้อนหลังได้ครบ เหมือนที่การลบมี admissions_deletion_log อยู่แล้ว
--   (1) ตาราง admissions_restore_log (เพิ่มอย่างเดียว อ่านได้เฉพาะ admin/developer) — เก็บผู้เพิ่ม เวลา และ raw_id ของแถวดิบต้นทาง
--   (2) restore_admission_from_raw: เขียน log ใน transaction เดียวกับการเพิ่มเคส (เพิ่มเคสโดยไม่มี log ไม่ได้)
--   (3) view v_admission_events: ประวัติ "ถูกลบ" + "เพิ่มใหม่จากดิบ" ของแต่ละ encounter (ใช้แสดงไทม์ไลน์ในหน้า Compare)
--   (4) v_raw_vs_current: สถานะใหม่ 'เพิ่มใหม่จากดิบ' (ค้างถาวรจนกว่าจะมีการลบหลังจากนั้น) + เวลา/ผู้เพิ่มรวมใน last_updated / last_editor
-- ปลอดภัย: ไม่แตะ/ไม่แก้ข้อมูลดิบ ไม่แก้ข้อมูลเดิมใน admissions · รันซ้ำได้
-- ต้องรันไฟล์ 20261105_compare_audit_trail.sql และ 20261106_restore_from_raw.sql มาก่อน

-- (1) log การเพิ่มจากดิบ
create table if not exists public.admissions_restore_log (
  log_id bigint generated always as identity primary key,
  admission_id bigint, encounter_id bigint, hn text, coverage_code text, payer_id text, discharge_date date,
  source_raw_id bigint,                       -- แถวใน admissions_raw ที่ใช้สร้างเคสนี้
  restored_at timestamptz not null default now(),
  restored_by uuid
);
create index if not exists admissions_restore_log_enc on public.admissions_restore_log (encounter_id);
alter table public.admissions_restore_log enable row level security;
drop policy if exists restore_log_select_admin on public.admissions_restore_log;
create policy restore_log_select_admin on public.admissions_restore_log for select to authenticated using (public.is_admin());
revoke all on public.admissions_restore_log from anon, authenticated;
grant select on public.admissions_restore_log to authenticated;

-- (2) ฟังก์ชันเพิ่มเคสจากดิบ: เหมือนเดิม + เขียน log ทุกแถวที่เพิ่มจริง
create or replace function public.restore_admission_from_raw(p_encounter_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enc bigint;
  n_pairs int; n_ins int := 0; n_pat int := 0; n_skip int := 0;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  v_enc := public._clean_txt(p_encounter_id)::numeric::bigint;
  if v_enc is null then
    raise exception 'encounter_id ไม่ถูกต้อง';
  end if;

  drop table if exists _rsrc;
  create temp table _rsrc on commit drop as
  with p as (
    select r.raw_id, r.uploaded_at, r.payload as j
      from public.admissions_raw r
     where r.encounter_id = v_enc::text
  ), x as (
    select raw_id, uploaded_at,
      public._clean_txt(coalesce(j->>'HN', j->>'hn')) as hn,
      public._clean_txt(j->>'AN')::numeric::bigint as an,
      public._clean_txt(j->>'name') as full_name,
      public._clean_txt(j->>'admit_date')::date as admit_date,
      public._clean_txt(coalesce(j->>'admited_time', j->>'admit_time'))::time as admit_time,
      public._clean_txt(j->>'discharge_date')::date as discharge_date,
      public._clean_txt(j->>'discharge_time')::time as discharge_time,
      public._clean_txt(j->>'division_code') as division_code,
      public._clean_txt(coalesce(j->>'status ', j->>'status'))::numeric::int as hstatus,
      public._clean_txt(j->>'Los')::numeric::int as los,
      public._clean_txt(coalesce(j->>'birthdate ', j->>'birthdate'))::date as birthdate,
      coalesce(public._clean_txt(j->>'coverage_code'), 'UNK') as coverage_code,
      public._clean_txt(j->>'coverage_name') as coverage_name,
      coalesce(public._clean_txt(j->>'payer_id'), 'UNK') as payer_id,
      public._clean_txt(j->>'payer_name') as payer_name
    from p
  )
  -- แต่ละคู่ สิทธิ/ผู้จ่าย ใช้แถวดิบล่าสุด
  select distinct on (coverage_code, payer_id) * from x
   order by coverage_code, payer_id, uploaded_at desc, raw_id desc;

  select count(*) into n_pairs from _rsrc;
  if n_pairs = 0 then
    raise exception 'ไม่พบ encounter นี้ในข้อมูลดิบ';
  end if;

  -- ถ้ามีสิทธิจริงอยู่ ไม่สร้างแถว UNK (กฎเดียวกับ import_admissions)
  delete from _rsrc s
   where s.coverage_code = 'UNK' and s.payer_id = 'UNK'
     and exists (select 1 from _rsrc o where not (o.coverage_code = 'UNK' and o.payer_id = 'UNK'));
  get diagnostics n_skip = row_count;

  if exists (select 1 from _rsrc where hn is null or an is null or admit_date is null) then
    raise exception 'ข้อมูลดิบไม่ครบ (HN / AN / วันรับ) จึงสร้างเคสไม่ได้';
  end if;

  -- master: เพิ่มเฉพาะที่ยังไม่มี ไม่แก้ของเดิม
  with x as (
    insert into patients(hn, full_name, birthdate)
    select distinct on (hn) hn, coalesce(full_name, '-'), birthdate from _rsrc order by hn, uploaded_at desc
    on conflict (hn) do nothing returning 1)
  select count(*) into n_pat from x;

  insert into coverage_master(coverage_code, coverage_name)
  select distinct on (coverage_code) coverage_code, coalesce(coverage_name, coverage_code) from _rsrc order by coverage_code, uploaded_at desc
  on conflict (coverage_code) do nothing;

  insert into payer_master(payer_id, payer_name)
  select distinct on (payer_id) payer_id, coalesce(payer_name, payer_id) from _rsrc order by payer_id, uploaded_at desc
  on conflict (payer_id) do nothing;

  insert into division_master(division_code)
  select distinct division_code from _rsrc where division_code is not null
  on conflict (division_code) do nothing;

  -- เพิ่มเคส + เขียน log ในคำสั่งเดียว (log นับเฉพาะแถวที่เพิ่มจริง ไม่ใช่แถวที่มีอยู่แล้ว)
  with x as (
    insert into admissions(encounter_id, an, hn, admit_date, admit_time, discharge_date, discharge_time,
                           division_code, hospital_status_code, los, coverage_code, payer_id)
    select v_enc, an, hn, admit_date, admit_time, discharge_date, discharge_time,
           division_code, hstatus, los, coverage_code, payer_id from _rsrc
    on conflict (encounter_id, coverage_code, payer_id) do nothing
    returning admission_id, encounter_id, hn, coverage_code, payer_id, discharge_date),
  l as (
    insert into admissions_restore_log(admission_id, encounter_id, hn, coverage_code, payer_id, discharge_date, source_raw_id, restored_by)
    select x.admission_id, x.encounter_id, x.hn, x.coverage_code, x.payer_id, x.discharge_date, s.raw_id, auth.uid()
      from x join _rsrc s on s.coverage_code = x.coverage_code and s.payer_id = x.payer_id
    returning 1)
  select count(*) into n_ins from l;

  return jsonb_build_object('encounter_id', v_enc, 'raw_pairs', n_pairs, 'admissions_inserted', n_ins,
                            'already_existed', n_pairs - n_skip - n_ins, 'new_patients', n_pat);
end;
$$;

revoke execute on function public.restore_admission_from_raw(text) from public, anon;
grant  execute on function public.restore_admission_from_raw(text) to authenticated, service_role;

-- (3) ประวัติเหตุการณ์เพิ่ม/ลบ ต่อ encounter (อ่านได้เฉพาะ admin/developer ผ่าน RLS ของตาราง log)
create or replace view public.v_admission_events with (security_invoker = true) as
select 'deleted'::text as event, l.encounter_id::text as encounter_id, l.admission_id, l.coverage_code, l.payer_id,
       l.deleted_at as at, u.email as by_email,
       null::bigint as raw_id, null::text as source_file, null::date as file_date, null::timestamptz as raw_uploaded_at
  from public.admissions_deletion_log l
  left join public.app_users u on u.id = l.deleted_by
union all
select 'restored'::text, r.encounter_id::text, r.admission_id, r.coverage_code, r.payer_id,
       r.restored_at, u.email,
       r.source_raw_id, w.source_file, w.file_date, w.uploaded_at
  from public.admissions_restore_log r
  left join public.app_users u on u.id = r.restored_by
  left join public.admissions_raw w on w.raw_id = r.source_raw_id;
grant select on public.v_admission_events to authenticated;

-- (4) สถานะ 'เพิ่มใหม่จากดิบ': เคสมีในระบบ ตรงกับดิบ และเหตุการณ์ล่าสุดคือการเพิ่มจากดิบ (ไม่มีการลบหลังจากนั้น)
--     ถ้าสิทธิ/ผู้จ่ายต่างจากดิบ ยังแสดง 'ต่างจากดิบ' ก่อน (ต้องตรวจมากกว่า) — เวลา/ผู้เพิ่มยังเห็นในคอลัมน์ แก้ไขล่าสุด/โดย
--     คอลัมน์เดิมคงลำดับเดิม เพิ่ม restored_at ต่อท้าย
create or replace view public.v_raw_vs_current with (security_invoker = true) as
with n as (
  select encounter_id, uploaded_at,
    coalesce(nullif(nullif(upper(trim(coverage_code)),''),'NULL'),'UNK') cov,
    coalesce(nullif(nullif(upper(trim(payer_id)),''),'NULL'),'UNK') pay,
    case when discharge_date ~ '^\d{4}-\d{2}-\d{2}' then left(discharge_date,10)::date end dis
  from public.admissions_raw
), enc_raw as (
  select encounter_id, string_agg(distinct cov||'/'||pay, ', ') raw_pairs, min(uploaded_at) first_uploaded, max(dis) raw_discharge from n group by encounter_id
), enc_cur as (
  select a.encounter_id::text encounter_id, string_agg(a.coverage_code||'/'||a.payer_id, ', ' order by a.coverage_code) cur_pairs,
    max(a.discharge_date) cur_discharge,
    max(a.updated_at) filter (where a.updated_at > a.created_at + interval '1 second') last_edit,
    (array_agg(u.email order by a.updated_at desc) filter (where a.updated_by is not null and a.updated_at > a.created_at + interval '1 second'))[1] editor
  from public.admissions a left join public.app_users u on u.id = a.updated_by
  group by a.encounter_id
), del as (
  select l.encounter_id::text encounter_id, max(l.deleted_at) deleted_at,
    (array_agg(u.email order by l.deleted_at desc))[1] deleter
  from public.admissions_deletion_log l left join public.app_users u on u.id = l.deleted_by
  group by l.encounter_id
), rs as (
  select l.encounter_id::text encounter_id, max(l.restored_at) restored_at,
    (array_agg(u.email order by l.restored_at desc))[1] restorer
  from public.admissions_restore_log l left join public.app_users u on u.id = l.restored_by
  group by l.encounter_id
)
select coalesce(r.encounter_id, c.encounter_id) encounter_id, r.raw_pairs, c.cur_pairs, r.first_uploaded,
  case when r.encounter_id is null then 'ไม่มีในข้อมูลดิบ (เพิ่มเอง/ไม่ทราบที่มา)'
       when c.encounter_id is null then 'อยู่ในดิบ แต่ถูกลบจากระบบ'
       when r.raw_pairs is distinct from c.cur_pairs then 'สิทธิ/ผู้จ่ายต่างจากดิบ'
       when rs.restored_at is not null and (d.deleted_at is null or rs.restored_at > d.deleted_at) then 'เพิ่มใหม่จากดิบ'
       else 'ตรงกับดิบ' end as status,
  coalesce(c.cur_discharge, r.raw_discharge) as discharge_date,
  greatest(c.last_edit, d.deleted_at, rs.restored_at) as last_updated,   -- แก้ไข/ลบ/เพิ่มใหม่ ล่าสุด (ใช้กรอง "วันที่แก้ไข")
  case
    when rs.restored_at is not null
         and rs.restored_at >= coalesce(d.deleted_at, '-infinity'::timestamptz)
         and rs.restored_at >= coalesce(c.last_edit, '-infinity'::timestamptz) then rs.restorer
    when d.deleted_at is not null
         and d.deleted_at >= coalesce(c.last_edit, '-infinity'::timestamptz) then d.deleter
    else c.editor end as last_editor,
  d.deleted_at,
  rs.restored_at
from enc_raw r full join enc_cur c using (encounter_id)
left join del d on d.encounter_id = coalesce(r.encounter_id, c.encounter_id)
left join rs on rs.encounter_id = coalesce(r.encounter_id, c.encounter_id);
