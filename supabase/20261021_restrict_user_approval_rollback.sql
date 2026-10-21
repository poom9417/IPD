-- ย้อนกลับ restrict_user_approval_20261021 (คืนกติกาเดิม: admin / developer อนุมัติได้)
begin;

drop trigger if exists trg_guard_app_users_update on public.app_users;
drop function if exists public.guard_app_users_update();

drop policy if exists "approver update app_users" on public.app_users;
drop policy if exists "read app_users" on public.app_users;

create policy "read own app_user" on public.app_users
  for select using ((auth.uid() = id) or public.is_admin());
create policy "admin manage app_users" on public.app_users
  for update using (public.is_admin());

create or replace function public.set_user_approval(p_user uuid, p_status text, p_role text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tgt_role text;
begin
  if not public.is_admin() then
    raise exception 'เฉพาะ admin / developer เท่านั้น';
  end if;
  if p_status not in ('pending','approved','rejected') then
    raise exception 'สถานะไม่ถูกต้อง';
  end if;
  if p_user = auth.uid() then
    raise exception 'เปลี่ยนสถานะของตัวเองไม่ได้';
  end if;
  select role into tgt_role from public.app_users where id = p_user;
  if tgt_role is null then
    raise exception 'ไม่พบผู้ใช้';
  end if;
  if tgt_role = 'developer' then
    raise exception 'บัญชี developer ไม่สามารถแก้ไขได้';
  end if;

  if p_status = 'approved' then
    if p_role is null or p_role not in ('admin','user','audit','viewer') then
      raise exception 'ต้องเลือก role (admin / user / audit / viewer)';
    end if;
    update public.app_users
       set approval_status = 'approved', role = p_role, approved_by = auth.uid(), approved_at = now()
     where id = p_user;
  else
    update public.app_users
       set approval_status = p_status, approved_by = null, approved_at = null
     where id = p_user;
  end if;
end;
$$;

drop function if exists public.is_approver();

commit;
