-- หน้า Compare: ปุ่ม "เพิ่มเคสจากดิบ" สำหรับเคสสถานะ "อยู่ในดิบ แต่ถูกลบจากระบบ"
-- สร้างแถวใน admissions (+ patients / coverage / payer / division ถ้ายังไม่มี) จาก admissions_raw
-- อ่านดิบอย่างเดียว: ไม่ INSERT/UPDATE/DELETE admissions_raw และไม่เรียก raw_load_rows
-- ปลอดภัย: admin/developer เท่านั้น · ไม่ทับข้อมูลเดิม (on conflict do nothing) · รันซ้ำได้

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

  with x as (
    insert into admissions(encounter_id, an, hn, admit_date, admit_time, discharge_date, discharge_time,
                           division_code, hospital_status_code, los, coverage_code, payer_id)
    select v_enc, an, hn, admit_date, admit_time, discharge_date, discharge_time,
           division_code, hstatus, los, coverage_code, payer_id from _rsrc
    on conflict (encounter_id, coverage_code, payer_id) do nothing
    returning 1)
  select count(*) into n_ins from x;

  return jsonb_build_object('encounter_id', v_enc, 'raw_pairs', n_pairs, 'admissions_inserted', n_ins,
                            'already_existed', n_pairs - n_skip - n_ins, 'new_patients', n_pat);
end;
$$;

revoke execute on function public.restore_admission_from_raw(text) from public, anon;
grant  execute on function public.restore_admission_from_raw(text) to authenticated, service_role;
