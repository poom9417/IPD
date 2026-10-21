-- ระบบอนุมัติผู้ใช้ใหม่ (2026-10-20)
-- ผู้ใช้ที่ล็อกอินครั้งแรกจะเป็น 'pending' จนกว่า developer/admin จะอนุมัติ
-- สำรองก่อนรัน: bak_app_users_20261020

-- 1) คอลัมน์สถานะ
alter table public.app_users
  add column if not exists approval_status text not null default 'pending',
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz;

alter table public.app_users drop constraint if exists app_users_approval_status_check;
alter table public.app_users
  add constraint app_users_approval_status_check check (approval_status in ('pending','approved','rejected'));

-- ผู้ใช้ที่มีอยู่แล้วทั้งหมด = อนุมัติแล้ว
update public.app_users
   set approval_status = 'approved', approved_at = coalesce(approved_at, now())
 where approval_status <> 'approved';

-- 2) ฟังก์ชันตรวจสถานะ
create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_users where id = auth.uid() and approval_status = 'approved');
$$;

-- ทุกฟังก์ชันเช็ก role ต้องผ่านการอนุมัติก่อน (คนถูกถอนสิทธิ์จะได้ role = null / false)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_users
                 where id = auth.uid() and approval_status = 'approved' and role in ('admin','developer'));
$$;

create or replace function public.is_editor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_users
                 where id = auth.uid() and approval_status = 'approved' and role in ('admin','developer','user'));
$$;

create or replace function public.is_developer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_users
                 where id = auth.uid() and approval_status = 'approved' and role = 'developer');
$$;

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.app_users where id = auth.uid() and approval_status = 'approved';
$$;

-- 3) trigger สมัครใหม่ = pending (developer = approved)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email !~* '@mahidol\.ac\.th$' then
    raise exception 'Only @mahidol.ac.th accounts are allowed to sign in';
  end if;
  insert into public.app_users (id, email, role, approval_status, approved_at)
  values (
    new.id,
    new.email,
    case when lower(new.email) = 'nattapoom.chu@mahidol.ac.th' then 'developer' else 'viewer' end,
    case when lower(new.email) = 'nattapoom.chu@mahidol.ac.th' then 'approved' else 'pending' end,
    case when lower(new.email) = 'nattapoom.chu@mahidol.ac.th' then now() else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 4) RPC อนุมัติ / ปฏิเสธ / ถอนกลับเป็นรออนุมัติ
create or replace function public.set_user_approval(p_user uuid, p_status text, p_role text default null)
returns void language plpgsql security definer set search_path = public as $$
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

revoke all on function public.set_user_approval(uuid, text, text) from public, anon;
grant execute on function public.set_user_approval(uuid, text, text) to authenticated;
revoke all on function public.is_approved() from public, anon;
grant execute on function public.is_approved() to authenticated;

-- 5) RPC ที่ใช้แค่ auth.uid() ต้องเช็กการอนุมัติด้วย (แทรกบรรทัดเช็กหลัง begin แรก)
do $$
declare
  fn text;
  def text;
begin
  foreach fn in array array['assign_responsibilities','respond_assignments','set_my_coverages','code_c_ack_case','code_c_ack_item'] loop
    select pg_get_functiondef(p.oid) into def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn;
    if def is not null and def !~ 'is_approved' then
      def := regexp_replace(def, '\mbegin\M',
        E'begin\n  if not public.is_approved() then raise exception ''บัญชียังไม่ได้รับอนุมัติ''; end if;', 'i');
      execute def;
    end if;
  end loop;
end $$;

-- 6) RLS: อ่านข้อมูลได้เฉพาะผู้ใช้ที่อนุมัติแล้ว
drop policy if exists "read admissions" on public.admissions;
create policy "read admissions" on public.admissions for select using (public.is_approved());
drop policy if exists "read case_tracking" on public.case_tracking;
create policy "read case_tracking" on public.case_tracking for select using (public.is_approved());
drop policy if exists "read coverage_master" on public.coverage_master;
create policy "read coverage_master" on public.coverage_master for select using (public.is_approved());
drop policy if exists "read division_master" on public.division_master;
create policy "read division_master" on public.division_master for select using (public.is_approved());
drop policy if exists "read patients" on public.patients;
create policy "read patients" on public.patients for select using (public.is_approved());
drop policy if exists "read payer_master" on public.payer_master;
create policy "read payer_master" on public.payer_master for select using (public.is_approved());

drop policy if exists "read assignment_requests" on public.assignment_requests;
create policy "read assignment_requests" on public.assignment_requests for select to authenticated using (public.is_approved());
drop policy if exists "read code_c_cases" on public.code_c_cases;
create policy "read code_c_cases" on public.code_c_cases for select to authenticated using (public.is_approved());
drop policy if exists "read code_c_history" on public.code_c_history;
create policy "read code_c_history" on public.code_c_history for select to authenticated using (public.is_approved());
drop policy if exists "read code_c_items" on public.code_c_items;
create policy "read code_c_items" on public.code_c_items for select to authenticated using (public.is_approved());
drop policy if exists "read coverage_assignments" on public.coverage_assignments;
create policy "read coverage_assignments" on public.coverage_assignments for select to authenticated using (public.is_approved());
