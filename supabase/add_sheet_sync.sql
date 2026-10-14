-- ซิงก์ Google Sheet: ตารางสถานะ (แถวเดียว) + RPC บันทึกเวลาดึงวัน Audit
-- รันใน Supabase Dashboard > SQL Editor (ปลอดภัยที่จะรันซ้ำ)

create table if not exists public.sheet_sync_state (
  id              int primary key default 1 check (id = 1),
  last_push_at    timestamptz,
  last_push_by    text,
  last_push_rows  int,
  last_push_ok    boolean,
  last_push_error text,
  last_pull_at    timestamptz,
  last_pull_by    text,
  last_pull_rows  int
);

insert into public.sheet_sync_state (id) values (1) on conflict (id) do nothing;

alter table public.sheet_sync_state enable row level security;

drop policy if exists "admin read sheet_sync_state" on public.sheet_sync_state;
create policy "admin read sheet_sync_state" on public.sheet_sync_state
  for select to authenticated using (public.is_admin());

-- ไม่มี policy insert/update/delete: ผู้ใช้เขียนตรงไม่ได้ (Edge Function ใช้ service role ข้าม RLS)

create or replace function public.mark_sheet_pull(p_rows int)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_admin() then
    raise exception 'เฉพาะ admin / developer';
  end if;
  update public.sheet_sync_state
     set last_pull_at = now(),
         last_pull_by = public.my_email(),
         last_pull_rows = p_rows
   where id = 1;
end $$;

revoke all on function public.mark_sheet_pull(int) from public, anon;
grant execute on function public.mark_sheet_pull(int) to authenticated;
