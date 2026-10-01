-- เพิ่ม role "user" (รันแล้วบน production เมื่อ 2026-10-01 — เก็บไว้เป็นบันทึก/ใช้ตั้ง environment ใหม่)
alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users add constraint app_users_role_check
  check (role = any (array['admin'::text, 'user'::text, 'viewer'::text]));

create or replace function public.is_editor()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.app_users where id = auth.uid() and role in ('admin','user'));
$$;

drop policy if exists "admin write admissions" on public.admissions;
create policy "editor insert admissions" on public.admissions for insert to authenticated with check (public.is_editor());
drop policy if exists "admin write patients" on public.patients;
create policy "editor insert patients" on public.patients for insert to authenticated with check (public.is_editor());
drop policy if exists "admin write case_tracking" on public.case_tracking;
create policy "editor insert case_tracking" on public.case_tracking for insert to authenticated with check (public.is_editor());
drop policy if exists "admin update case_tracking" on public.case_tracking;
create policy "editor update case_tracking" on public.case_tracking for update to authenticated using (public.is_editor()) with check (public.is_editor());
