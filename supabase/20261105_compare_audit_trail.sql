-- หน้า Compare: (1) บันทึกผู้สร้าง/แก้แถวใน admissions (2) บันทึกวัน-ผู้ลบแถว (3) ปรับ view v_raw_vs_current
-- ปลอดภัย: เพิ่มคอลัมน์ + ตาราง log + trigger + เพิ่มคอลัมน์ใน view เท่านั้น ไม่แก้ข้อมูลเดิม ไม่แตะ Google Sheet
-- ไฟล์นี้รวมและแทน 20261105_admissions_updated_by.sql (รันซ้ำได้) — ย้อนหลัง: แถวที่แก้/ลบก่อนรันไฟล์นี้ไม่มีข้อมูลผู้แก้/วันลบ
alter table public.admissions add column if not exists updated_by uuid references auth.users(id) on delete set null;

create or replace function public._admissions_set_editor() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  new.updated_by := coalesce(auth.uid(), case when tg_op = 'UPDATE' then old.updated_by end);
  return new;
end $$;
drop trigger if exists trg_admissions_set_editor on public.admissions;
create trigger trg_admissions_set_editor before insert or update on public.admissions
  for each row execute function public._admissions_set_editor();

-- log การลบ (เพิ่มอย่างเดียว อ่านได้เฉพาะ admin/developer)
create table if not exists public.admissions_deletion_log (
  log_id bigint generated always as identity primary key,
  admission_id bigint, encounter_id bigint, hn text, coverage_code text, payer_id text, discharge_date date,
  deleted_at timestamptz not null default now(),
  deleted_by uuid
);
create index if not exists admissions_deletion_log_enc on public.admissions_deletion_log (encounter_id);
alter table public.admissions_deletion_log enable row level security;
drop policy if exists del_log_select_admin on public.admissions_deletion_log;
create policy del_log_select_admin on public.admissions_deletion_log for select to authenticated using (public.is_admin());
revoke all on public.admissions_deletion_log from anon, authenticated;
grant select on public.admissions_deletion_log to authenticated;

create or replace function public._admissions_log_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.admissions_deletion_log(admission_id, encounter_id, hn, coverage_code, payer_id, discharge_date, deleted_by)
  values (old.admission_id, old.encounter_id, old.hn, old.coverage_code, old.payer_id, old.discharge_date, auth.uid());
  return old;
end $$;
drop trigger if exists trg_admissions_log_delete on public.admissions;
create trigger trg_admissions_log_delete after delete on public.admissions
  for each row execute function public._admissions_log_delete();

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
)
select coalesce(r.encounter_id, c.encounter_id) encounter_id, r.raw_pairs, c.cur_pairs, r.first_uploaded,
  case when r.encounter_id is null then 'ไม่มีในข้อมูลดิบ (เพิ่มเอง/ไม่ทราบที่มา)'
       when c.encounter_id is null then 'อยู่ในดิบ แต่ถูกลบจากระบบ'
       when r.raw_pairs is distinct from c.cur_pairs then 'สิทธิ/ผู้จ่ายต่างจากดิบ'
       else 'ตรงกับดิบ' end as status,
  coalesce(c.cur_discharge, r.raw_discharge) as discharge_date,
  greatest(c.last_edit, d.deleted_at) as last_updated,   -- แก้ไขหรือลบล่าสุด (ใช้กรอง "วันที่แก้ไข")
  case when d.deleted_at is not null and (c.last_edit is null or d.deleted_at >= c.last_edit) then d.deleter else c.editor end as last_editor,
  d.deleted_at
from enc_raw r full join enc_cur c using (encounter_id)
left join del d on d.encounter_id = coalesce(r.encounter_id, c.encounter_id);
