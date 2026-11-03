-- เคสที่ผู้ใช้ตรวจแล้วและเลือก "ข้าม" ในหน้า ดึงวัน Audit จาก Google Sheet → แสดงในแท็บ "เคยบันทึกแล้ว"
-- key = encounter_id + สิทธิในชีต + วัน Audit ในชีต (ถ้าชีตเปลี่ยนวัน/สิทธิ เคสจะกลับมาให้ตรวจใหม่)
-- รันใน Supabase SQL Editor (ปลอดภัยที่จะรันซ้ำ)

create table if not exists public.sheet_pull_skips (
  id               bigint generated always as identity primary key,
  encounter_id     bigint not null,
  sheet_sithi      text   not null default '',   -- สิทธิในชีต (ตัวพิมพ์เล็ก ว่าง = '')
  sheet_audit_date date   not null,
  reason           text   not null default '',   -- ข้อความเหตุผลตอนข้าม เช่น สิทธิไม่ตรง (ระบบ: ISSI_3 / Audit: ISSI)
  targets          jsonb  not null default '[]'::jsonb, -- snapshot [{coverage_code,payer_id,existing}]
  skipped_by       text,
  skipped_at       timestamptz not null default now(),
  unique (encounter_id, sheet_sithi, sheet_audit_date)
);

alter table public.sheet_pull_skips enable row level security;

drop policy if exists "admin read sheet_pull_skips" on public.sheet_pull_skips;
create policy "admin read sheet_pull_skips" on public.sheet_pull_skips
  for select to authenticated using (public.is_admin());

drop policy if exists "admin insert sheet_pull_skips" on public.sheet_pull_skips;
create policy "admin insert sheet_pull_skips" on public.sheet_pull_skips
  for insert to authenticated with check (public.is_admin());

drop policy if exists "admin update sheet_pull_skips" on public.sheet_pull_skips;
create policy "admin update sheet_pull_skips" on public.sheet_pull_skips
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin delete sheet_pull_skips" on public.sheet_pull_skips;
create policy "admin delete sheet_pull_skips" on public.sheet_pull_skips
  for delete to authenticated using (public.is_admin());

-- บันทึกผู้ข้ามอัตโนมัติ (ไม่เชื่อค่าจากหน้าเว็บ)
create or replace function public.sheet_pull_skips_set_by()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  new.skipped_by := public.my_email();
  new.skipped_at := now();
  return new;
end $$;

drop trigger if exists trg_sheet_pull_skips_set_by on public.sheet_pull_skips;
create trigger trg_sheet_pull_skips_set_by
  before insert or update on public.sheet_pull_skips
  for each row execute function public.sheet_pull_skips_set_by();
