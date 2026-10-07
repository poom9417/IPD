-- add_developer_role.sql  (ใช้กับ Supabase ที่ apply ไปแล้วเมื่อ 2026-10-07 — เก็บไว้เป็นบันทึก/สร้างใหม่)
-- developer = admin + จำลอง role ได้ (ฝั่งหน้าเว็บ) และ admin แก้/ลบ/ตั้ง role developer ไม่ได้

alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users add constraint app_users_role_check
  check (role = any (array['admin','user','viewer','audit','developer']));

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.app_users where id = auth.uid() and role in ('admin','developer'));
$$;

create or replace function public.is_editor()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.app_users where id = auth.uid() and role in ('admin','developer','user'));
$$;

create or replace function public.is_developer()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.app_users where id = auth.uid() and role = 'developer');
$$;

alter policy "editor insert case_tracking" on public.case_tracking
  with check (my_role() = any (array['admin','developer','user','audit']));
alter policy "editor update case_tracking" on public.case_tracking
  using (my_role() = any (array['admin','developer','user','audit']))
  with check (my_role() = any (array['admin','developer','user','audit']));
alter policy "insert code_c_cases" on public.code_c_cases
  with check (my_role() = any (array['admin','developer','user']));
alter policy "update code_c_cases" on public.code_c_cases
  using (my_role() = any (array['admin','developer','user','audit']))
  with check (my_role() = any (array['admin','developer','user','audit']));

create or replace function public.guard_developer_role()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  actor uuid := auth.uid();
  actor_role text;
begin
  if actor is null then  -- dashboard / service role / migration
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select role into actor_role from public.app_users where id = actor;
  if actor_role = 'developer' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if old.role = 'developer' then
    raise exception 'บัญชี developer ไม่สามารถแก้ไขหรือลบได้';
  end if;
  if tg_op = 'UPDATE' and new.role = 'developer' then
    raise exception 'ไม่สามารถตั้งสิทธิ์ developer ได้';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists trg_guard_developer_role on public.app_users;
create trigger trg_guard_developer_role
  before update or delete on public.app_users
  for each row execute function public.guard_developer_role();

-- signup trigger: อีเมลเจ้าของระบบได้ role developer ตอน login ครั้งแรก (ดู handle_new_user ใน DB)
update public.app_users set role = 'developer' where lower(email) = 'nattapoom.chu@mahidol.ac.th';
