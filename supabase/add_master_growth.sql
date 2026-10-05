-- 2026-10-05: ให้ สิทธิ / ผู้จ่าย / หอผู้ป่วย เพิ่มได้จากหน้า "เพิ่มเคส" และอัพเดตชื่อจากไฟล์นำเข้าล่าสุด
-- (รันแล้วบน production — เก็บไว้เป็นบันทึก/ใช้ตั้ง environment ใหม่)

-- 1) หอผู้ป่วย (division) — เดิมเป็น text ลอยใน admissions ไม่มีตารางหลัก
create table if not exists public.division_master (
  division_code text primary key,
  division_name text,
  created_at timestamptz not null default now()
);
alter table public.division_master enable row level security;

insert into public.division_master (division_code)
select distinct division_code from public.admissions where division_code is not null
on conflict do nothing;

drop policy if exists "read division_master" on public.division_master;
create policy "read division_master" on public.division_master
  for select using (auth.role() = 'authenticated');
drop policy if exists "editor insert division_master" on public.division_master;
create policy "editor insert division_master" on public.division_master
  for insert with check (public.is_editor());
drop policy if exists "admin update division_master" on public.division_master;
create policy "admin update division_master" on public.division_master
  for update using (public.is_admin());

-- 2) admin + user เพิ่มสิทธิ/ผู้จ่ายใหม่ได้ (แก้/ลบยังเป็นของ admin)
drop policy if exists "editor insert coverage_master" on public.coverage_master;
create policy "editor insert coverage_master" on public.coverage_master
  for insert with check (public.is_editor());
drop policy if exists "editor insert payer_master" on public.payer_master;
create policy "editor insert payer_master" on public.payer_master
  for insert with check (public.is_editor());

-- 3) import_admissions: เพิ่มหอผู้ป่วยใหม่ + อัพเดตชื่อสิทธิ/ผู้จ่ายตามไฟล์ล่าสุด
create or replace function public.import_admissions(rows jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n_total int; n_invalid int := 0; n_dup int := 0; n_unk_skip int := 0; n_promo int := 0;
  n_pat int := 0; n_cov int := 0; n_pay int := 0; n_ins int := 0; n_upd int := 0;
  n_div int := 0; n_cov_upd int := 0; n_pay_upd int := 0;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  drop table if exists _src;
  create temp table _src on commit drop as
  select t.ord,
    public._clean_txt(coalesce(r->>'HN', r->>'hn')) as hn,
    public._clean_txt(r->>'AN')::numeric::bigint as an,
    public._clean_txt(r->>'encounter_id')::numeric::bigint as encounter_id,
    public._clean_txt(r->>'name') as full_name,
    public._clean_txt(r->>'admit_date')::date as admit_date,
    public._clean_txt(coalesce(r->>'admited_time', r->>'admit_time'))::time as admit_time,
    public._clean_txt(r->>'discharge_date')::date as discharge_date,
    public._clean_txt(r->>'discharge_time')::time as discharge_time,
    public._clean_txt(r->>'division_code') as division_code,
    public._clean_txt(coalesce(r->>'status ', r->>'status'))::numeric::int as hstatus,
    public._clean_txt(r->>'Los')::numeric::int as los,
    public._clean_txt(coalesce(r->>'birthdate ', r->>'birthdate'))::date as birthdate,
    coalesce(public._clean_txt(r->>'coverage_code'), 'UNK') as coverage_code,
    public._clean_txt(r->>'coverage_name') as coverage_name,
    coalesce(public._clean_txt(r->>'payer_id'), 'UNK') as payer_id,
    public._clean_txt(r->>'payer_name') as payer_name
  from jsonb_array_elements(rows) with ordinality as t(r, ord);

  select count(*) into n_total from _src;

  delete from _src where hn is null or an is null or encounter_id is null or admit_date is null;
  get diagnostics n_invalid = row_count;

  delete from _src s using _src s2
   where s.encounter_id = s2.encounter_id and s.coverage_code = s2.coverage_code
     and s.payer_id = s2.payer_id and s.ord < s2.ord;
  get diagnostics n_dup = row_count;

  delete from _src s
   where s.coverage_code = 'UNK' and s.payer_id = 'UNK'
     and (exists (select 1 from admissions a where a.encounter_id = s.encounter_id
                    and not (a.coverage_code = 'UNK' and a.payer_id = 'UNK'))
       or exists (select 1 from _src o where o.encounter_id = s.encounter_id
                    and not (o.coverage_code = 'UNK' and o.payer_id = 'UNK')));
  get diagnostics n_unk_skip = row_count;

  with x as (
    insert into patients(hn, full_name, birthdate)
    select distinct on (hn) hn, coalesce(full_name, '-'), birthdate from _src order by hn, ord desc
    on conflict (hn) do update
      set full_name = excluded.full_name,
          birthdate = coalesce(excluded.birthdate, patients.birthdate),
          updated_at = now()
    returning (xmax = 0) as ins)
  select count(*) filter (where ins) into n_pat from x;

  -- สิทธิ: เพิ่มใหม่ถ้ายังไม่มี / ถ้ามีแล้วแต่ชื่อในไฟล์ล่าสุดต่าง → อัพเดตตามไฟล์
  with x as (
    insert into coverage_master(coverage_code, coverage_name)
    select distinct on (coverage_code) coverage_code, coalesce(coverage_name, coverage_code)
      from _src order by coverage_code, ord desc
    on conflict (coverage_code) do nothing returning 1)
  select count(*) into n_cov from x;

  with u as (
    update coverage_master c set coverage_name = s.coverage_name
      from (select distinct on (coverage_code) coverage_code, coverage_name
              from _src where coverage_name is not null and coverage_code <> 'UNK'
             order by coverage_code, ord desc) s
     where c.coverage_code = s.coverage_code and c.coverage_name is distinct from s.coverage_name
    returning 1)
  select count(*) into n_cov_upd from u;

  -- ผู้จ่าย: ทำเหมือนสิทธิ
  with x as (
    insert into payer_master(payer_id, payer_name)
    select distinct on (payer_id) payer_id, coalesce(payer_name, payer_id)
      from _src order by payer_id, ord desc
    on conflict (payer_id) do nothing returning 1)
  select count(*) into n_pay from x;

  with u as (
    update payer_master p set payer_name = s.payer_name
      from (select distinct on (payer_id) payer_id, payer_name
              from _src where payer_name is not null and payer_id <> 'UNK'
             order by payer_id, ord desc) s
     where p.payer_id = s.payer_id and p.payer_name is distinct from s.payer_name
    returning 1)
  select count(*) into n_pay_upd from u;

  -- หอผู้ป่วย: เพิ่มรหัสใหม่ที่พบในไฟล์
  with x as (
    insert into division_master(division_code)
    select distinct division_code from _src where division_code is not null
    on conflict (division_code) do nothing returning 1)
  select count(*) into n_div from x;

  with cand as (
    select distinct on (s.encounter_id) s.encounter_id, s.coverage_code, s.payer_id
      from _src s
     where not (s.coverage_code = 'UNK' and s.payer_id = 'UNK')
       and not exists (select 1 from admissions a where a.encounter_id = s.encounter_id
                         and a.coverage_code = s.coverage_code and a.payer_id = s.payer_id)
       and exists (select 1 from admissions a where a.encounter_id = s.encounter_id
                     and a.coverage_code = 'UNK' and a.payer_id = 'UNK')
     order by s.encounter_id, s.ord)
  update admissions a set coverage_code = c.coverage_code, payer_id = c.payer_id, updated_at = now()
    from cand c
   where a.encounter_id = c.encounter_id and a.coverage_code = 'UNK' and a.payer_id = 'UNK';
  get diagnostics n_promo = row_count;

  with x as (
    insert into admissions(encounter_id, an, hn, admit_date, admit_time, discharge_date, discharge_time,
                           division_code, hospital_status_code, los, coverage_code, payer_id)
    select encounter_id, an, hn, admit_date, admit_time, discharge_date, discharge_time,
           division_code, hstatus, los, coverage_code, payer_id from _src
    on conflict (encounter_id, coverage_code, payer_id) do update
      set an = excluded.an, hn = excluded.hn, admit_date = excluded.admit_date,
          admit_time = excluded.admit_time, discharge_date = excluded.discharge_date,
          discharge_time = excluded.discharge_time, division_code = excluded.division_code,
          hospital_status_code = excluded.hospital_status_code, los = excluded.los,
          updated_at = now()
    returning (xmax = 0) as ins)
  select count(*) filter (where ins), count(*) filter (where not ins) into n_ins, n_upd from x;

  return jsonb_build_object(
    'rows_in_file', n_total, 'invalid_skipped', n_invalid, 'duplicate_in_file_skipped', n_dup,
    'unk_placeholder_skipped', n_unk_skip, 'unk_promoted_to_real_coverage', n_promo,
    'new_patients', n_pat, 'new_coverages', n_cov, 'new_payers', n_pay,
    'updated_coverages', n_cov_upd, 'updated_payers', n_pay_upd, 'new_divisions', n_div,
    'admissions_inserted', n_ins, 'admissions_updated', n_upd);
end;
$function$;

revoke execute on function public.import_admissions(jsonb) from public, anon;
grant  execute on function public.import_admissions(jsonb) to authenticated, service_role;
