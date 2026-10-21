-- Migration: restrict_user_approval_20261021
-- กติกาใหม่: อนุมัติ/ปฏิเสธ/ยกเลิกการอนุมัติ และแก้หน่วยงาน ได้เฉพาะ Audit และ Developer (Admin ทำไม่ได้)
--   * Audit  อนุมัติได้แต่ "กำหนด/เปลี่ยน role ไม่ได้" (ผู้ที่อนุมัติจะได้ role เดิมที่มี คือ viewer ตอนสมัคร)
--   * เฉพาะ Developer เท่านั้นที่กำหนด/เปลี่ยน role ทุกชนิด (รวม admin)
--   * ห้ามเปลี่ยนสถานะ/role ของตัวเอง และห้ามแตะบัญชี developer
-- ไม่แตะข้อมูลในตาราง — เปลี่ยนเฉพาะฟังก์ชัน policy และ trigger (ย้อนกลับด้วย 20261021_restrict_user_approval_rollback.sql)

begin;

-- 1) ผู้อนุมัติ = audit หรือ developer ที่ได้รับอนุมัติแล้ว
create or replace function public.is_approver()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.app_users
                 where id = auth.uid() and approval_status = 'approved' and role in ('audit', 'developer'));
$$;
revoke execute on function public.is_approver() from public, anon;
grant  execute on function public.is_approver() to authenticated;

-- 2) set_user_approval: เฉพาะผู้อนุมัติ + จำกัด role ที่ audit ตั้งได้
create or replace function public.set_user_approval(p_user uuid, p_status text, p_role text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tgt_role   text;
  actor_role text;
begin
  if not public.is_approver() then
    raise exception 'เฉพาะ Audit / Developer เท่านั้นที่อนุมัติผู้ใช้ได้';
  end if;
  if p_status not in ('pending', 'approved', 'rejected') then
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
  actor_role := public.my_role();
  if actor_role <> 'developer' and p_role is not null and p_role is distinct from tgt_role then
    raise exception 'เฉพาะ Developer เท่านั้นที่กำหนด role ได้';
  end if;

  perform set_config('app.approval_rpc', '1', true);
  if p_status = 'approved' then
    if actor_role = 'developer' then
      if p_role is null or p_role not in ('admin', 'user', 'audit', 'viewer') then
        raise exception 'ต้องเลือก role (admin / user / audit / viewer)';
      end if;
      update public.app_users
         set approval_status = 'approved', role = p_role, approved_by = auth.uid(), approved_at = now()
       where id = p_user;
    else
      -- audit: อนุมัติได้ แต่ role คงเดิม
      update public.app_users
         set approval_status = 'approved', approved_by = auth.uid(), approved_at = now()
       where id = p_user;
    end if;
  else
    update public.app_users
       set approval_status = p_status, approved_by = null, approved_at = null
     where id = p_user;
  end if;
  perform set_config('app.approval_rpc', '0', true);
end;
$$;

-- 3) policy ของ app_users: admin ไม่มีสิทธิ์อ่านรายชื่อทั้งหมด/แก้ไขอีกต่อไป
drop policy if exists "admin manage app_users" on public.app_users;
drop policy if exists "read own app_user" on public.app_users;

create policy "read app_users" on public.app_users
  for select to authenticated
  using (auth.uid() = id or public.is_approver());

create policy "approver update app_users" on public.app_users
  for update to authenticated
  using (public.is_approver())
  with check (public.is_approver());

-- 4) trigger กัน audit แก้ตารางตรงเพื่อข้ามกฎ (developer ไม่ถูกจำกัด ยกเว้นกฎเดิมของ guard_developer_role)
create or replace function public.guard_app_users_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor      uuid := auth.uid();
  actor_role text;
  via_rpc    boolean := coalesce(current_setting('app.approval_rpc', true), '') = '1';
begin
  if actor is null then
    return new;                      -- service role / SQL Editor
  end if;
  select role into actor_role from public.app_users where id = actor;
  if actor_role = 'developer' then
    return new;
  end if;

  -- ผู้ใช้ทั่วไปแก้แถวตัวเองได้เฉพาะ onboarding (ผ่าน complete_onboarding)
  if new.id is distinct from old.id or new.email is distinct from old.email or new.created_at is distinct from old.created_at then
    raise exception 'แก้ id / อีเมล / วันที่สร้างไม่ได้';
  end if;

  if not via_rpc then
    if new.approval_status is distinct from old.approval_status
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at then
      raise exception 'เปลี่ยนสถานะการอนุมัติได้เฉพาะผ่านฟังก์ชันอนุมัติเท่านั้น';
    end if;
    if new.role is distinct from old.role then
      raise exception 'เฉพาะ Developer เท่านั้นที่กำหนด role ได้';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_app_users_update() from public, anon, authenticated;

drop trigger if exists trg_guard_app_users_update on public.app_users;
create trigger trg_guard_app_users_update
  before update on public.app_users
  for each row execute function public.guard_app_users_update();

commit;
