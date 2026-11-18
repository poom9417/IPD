-- เก็บผลตอบกลับ REP (ไฟล์ตอบรับผู้ป่วยในจากกรมบัญชีกลาง) + สถานะการสร้างไฟล์ SAP
-- ตารางใหม่ 2 ตาราง ไม่แก้ตารางเดิม
--   rep_files : 1 แถวต่อ 1 ไฟล์ REP (รหัส รพ. + เลขที่เอกสารตอบรับ)
--   rep_items : 1 แถวต่อ 1 เคสในไฟล์ (รายการผ่าน A และรายการที่ไม่ผ่าน เช่น C) พร้อมผลจับคู่กับ admissions/case_tracking
-- สิทธิ์: อ่าน/เขียนได้เฉพาะผู้ใช้ที่อนุมัติแล้ว และ role = admin / developer / user (มีชื่อผู้ป่วยและยอดเงิน → audit / viewer ไม่เห็น)

create table if not exists public.rep_files (
  id               bigint generated always as identity primary key,
  hosp_code        text        not null,
  rep_no           text        not null,
  issue_date       date        not null,
  header_count     integer,
  header_total     numeric,
  passed_count     integer     not null default 0,
  not_passed_count integer     not null default 0,
  source_file_name text,
  uploaded_by      uuid        default auth.uid(),
  uploaded_at      timestamptz not null default now(),
  unique (hosp_code, rep_no)
);

create table if not exists public.rep_items (
  id               bigint generated always as identity primary key,
  rep_file_id      bigint      not null references public.rep_files(id) on delete cascade,
  encounter_id     bigint      not null,          -- ไฟล์ REP เรียกว่า AN แต่เป็น encounter_id
  section          integer,                       -- ตอนที่ในไฟล์ REP (1 = กรมบัญชีกลาง); null/0 = ไม่ทราบ (รายการไม่ผ่าน)
  patient_name     text,
  tcode            text        not null,          -- A ผ่าน, C ต้องแก้ไข, T รอใบรับรองสิทธิ
  pcode            text,                          -- 0 ภายในกำหนด, 2 เกิน 90 วัน (ปรับ 10%), 3 เกิน 1 ปี (ปรับ 20%)
  drg_code         text,
  rw               numeric,
  adj_rw           numeric,
  ccuf             numeric,                       -- แสดงเฉพาะ DRG ยาเคมีบำบัดที่ ccuf < 1
  drg_amount       numeric,                       -- เงินตาม DRG (บาท)
  out_drg_amount   numeric,                       -- ยอดจ่ายนอก DRG (บาท)
  total_amount     numeric,                       -- รวมรายบุคคล = drg + นอก drg
  msg_raw          text,                          -- รหัสข้อผิดพลาด/เตือนท้ายบรรทัดตามไฟล์ REP
  match_status     text        not null default 'no_admission'
                   check (match_status in ('matched','no_admission','payer_mismatch','ambiguous','unmapped_payer')),
  match_note       text,
  admission_id     bigint      references public.admissions(admission_id) on delete set null,
  payer_id         text,
  coverage_code    text,
  claim_no         text,                          -- เลขตั้งเบิก (สำเนา ณ ตอนจับคู่ ล่าสุด)
  sap_generated_at timestamptz,
  sap_generated_by uuid,
  sap_file_name    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (rep_file_id, encounter_id)
);

create index if not exists rep_items_encounter_idx on public.rep_items (encounter_id);
create index if not exists rep_items_admission_idx on public.rep_items (admission_id);

alter table public.rep_files enable row level security;
alter table public.rep_items enable row level security;

drop policy if exists "rep_files rw" on public.rep_files;
drop policy if exists "rep_items rw" on public.rep_items;

create policy "rep_files rw" on public.rep_files
  for all to authenticated
  using ((select public.is_approved()) and (select public.my_role()) in ('admin','developer','user'))
  with check ((select public.is_approved()) and (select public.my_role()) in ('admin','developer','user'));

create policy "rep_items rw" on public.rep_items
  for all to authenticated
  using ((select public.is_approved()) and (select public.my_role()) in ('admin','developer','user'))
  with check ((select public.is_approved()) and (select public.my_role()) in ('admin','developer','user'));

-- ไม่ให้ลบจากหน้าเว็บ (ลบเฉพาะผ่าน SQL โดยผู้ดูแล)
revoke all on public.rep_files, public.rep_items from anon, authenticated;
grant select, insert, update on public.rep_files, public.rep_items to authenticated;

create or replace function public.rep_items_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists rep_items_touch on public.rep_items;
create trigger rep_items_touch before update on public.rep_items for each row execute function public.rep_items_touch();
