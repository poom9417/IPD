-- ============================================================================
-- IPD AR discharge — role "audit" + หน้า Code C + หน้า My job
-- รันซ้ำได้ (idempotent)  |  ตรงกับฐานข้อมูล production (Supabase project qwivyyvhezqbhlukcsmt)
--
-- กติกาที่ไฟล์นี้บังคับ
--   * audit: ลงได้เฉพาะ audit_date / audit_amount ใน case_tracking + ตอบช่อง "แก้ไขอย่างไร" ใน Code C
--   * My job: 1 สิทธิมีผู้ดูแลได้ "คนเดียว" และเฉพาะ role admin / user (audit และ viewer ใช้ไม่ได้)
-- หมายเหตุ: ไฟล์นี้ต้องรันหลัง add_user_role.sql (ใช้ public.is_admin() / is_editor())
-- ============================================================================

-- 1) role "audit" -------------------------------------------------------------
alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users add constraint app_users_role_check
  check (role = any (array['admin'::text, 'user'::text, 'viewer'::text, 'audit'::text]));

-- ดึง role / email ของคนที่ login อยู่ (SECURITY DEFINER เพื่อเลี่ยง RLS recursion บน app_users)
create or replace function public.my_role()
returns text language sql stable security definer set search_path to 'public' as $$
  select role from public.app_users where id = auth.uid();
$$;

create or replace function public.my_email()
returns text language sql stable security definer set search_path to 'public' as $$
  select email from public.app_users where id = auth.uid();
$$;

-- 2) case_tracking: เปิดให้ audit บันทึกได้ แต่ "แก้ได้เฉพาะ audit_date / audit_amount" -----
drop policy if exists "editor insert case_tracking" on public.case_tracking;
create policy "editor insert case_tracking" on public.case_tracking
  for insert to authenticated with check (public.my_role() in ('admin','user','audit'));

drop policy if exists "editor update case_tracking" on public.case_tracking;
create policy "editor update case_tracking" on public.case_tracking
  for update to authenticated
  using (public.my_role() in ('admin','user','audit'))
  with check (public.my_role() in ('admin','user','audit'));

create or replace function public.guard_case_tracking_audit()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if public.my_role() = 'audit' then
    if tg_op = 'INSERT' then
      if new.document_received_date is not null or new.submission_date is not null
         or new.submission_amount is not null or new.claim_no is not null then
        raise exception 'role audit บันทึกได้เฉพาะวันที่/ยอด Audit';
      end if;
    else
      if new.document_received_date is distinct from old.document_received_date
         or new.submission_date   is distinct from old.submission_date
         or new.submission_amount is distinct from old.submission_amount
         or new.claim_no          is distinct from old.claim_no then
        raise exception 'role audit แก้ได้เฉพาะวันที่/ยอด Audit';
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_case_tracking_audit on public.case_tracking;
create trigger trg_guard_case_tracking_audit
  before insert or update on public.case_tracking
  for each row execute function public.guard_case_tracking_audit();

-- 3) Code C ---------------------------------------------------------------------
create table if not exists public.code_c_cases (
  id            bigint generated always as identity primary key,
  admission_id  bigint not null references public.admissions(admission_id) on delete cascade,
  encounter_id  bigint not null,
  -- ฝั่ง user: ทำไมติด C
  reason        text   not null,
  deadline_date date   not null,
  reason_by     uuid,
  reason_by_email text,
  reason_at     timestamptz not null default now(),
  -- ฝั่ง audit: แก้ไขอย่างไร
  fix_detail    text,
  fix_by        uuid,
  fix_by_email  text,
  fix_at        timestamptz
);
create index if not exists code_c_cases_admission_idx on public.code_c_cases(admission_id);
create index if not exists code_c_cases_encounter_idx on public.code_c_cases(encounter_id);

alter table public.code_c_cases enable row level security;

drop policy if exists "read code_c_cases"   on public.code_c_cases;
drop policy if exists "insert code_c_cases" on public.code_c_cases;
drop policy if exists "update code_c_cases" on public.code_c_cases;
drop policy if exists "delete code_c_cases" on public.code_c_cases;
create policy "read code_c_cases"   on public.code_c_cases for select to authenticated using (true);
create policy "insert code_c_cases" on public.code_c_cases for insert to authenticated
  with check (public.my_role() in ('admin','user'));
create policy "update code_c_cases" on public.code_c_cases for update to authenticated
  using (public.my_role() in ('admin','user','audit'))
  with check (public.my_role() in ('admin','user','audit'));
create policy "delete code_c_cases" on public.code_c_cases for delete to authenticated
  using (public.is_admin());

-- ประทับชื่อ/เวลาโดยเซิร์ฟเวอร์ (ฝั่ง client แก้เวลาเองไม่ได้) + แยกสิทธิ์ว่าใครแก้ช่องไหนได้
create or replace function public.guard_code_c_cases()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  r text := public.my_role();
  em text := public.my_email();
begin
  if tg_op = 'INSERT' then
    new.reason_by := auth.uid();
    new.reason_by_email := em;
    new.reason_at := now();
    new.fix_detail := null; new.fix_by := null; new.fix_by_email := null; new.fix_at := null;
    return new;
  end if;

  -- UPDATE
  if new.admission_id is distinct from old.admission_id or new.encounter_id is distinct from old.encounter_id then
    raise exception 'เปลี่ยนเคสของรายการ Code C ไม่ได้ (ลบแล้วสร้างใหม่)';
  end if;

  if r = 'audit' then
    -- audit แก้ได้เฉพาะช่อง "แก้ไขอย่างไร"
    if new.reason is distinct from old.reason or new.deadline_date is distinct from old.deadline_date then
      raise exception 'role audit ตอบได้เฉพาะช่องการแก้ไข';
    end if;
  elsif r = 'user' then
    -- user แก้ได้เฉพาะช่องสาเหตุ/dateline ของตัวเอง และก่อน audit ตอบ
    if new.fix_detail is distinct from old.fix_detail then
      raise exception 'เฉพาะ audit เท่านั้นที่ตอบช่องการแก้ไขได้';
    end if;
    if old.reason_by is distinct from auth.uid() then
      raise exception 'แก้ได้เฉพาะรายการที่ตัวเองบันทึก';
    end if;
    if old.fix_detail is not null then
      raise exception 'audit ตอบแล้ว แก้สาเหตุไม่ได้';
    end if;
  end if;

  if new.reason is distinct from old.reason or new.deadline_date is distinct from old.deadline_date then
    new.reason_by := auth.uid(); new.reason_by_email := em; new.reason_at := now();
  else
    new.reason_by := old.reason_by; new.reason_by_email := old.reason_by_email; new.reason_at := old.reason_at;
  end if;

  if new.fix_detail is distinct from old.fix_detail then
    if nullif(btrim(new.fix_detail), '') is null then
      new.fix_detail := null; new.fix_by := null; new.fix_by_email := null; new.fix_at := null;
    else
      new.fix_by := auth.uid(); new.fix_by_email := em; new.fix_at := now();
    end if;
  else
    new.fix_by := old.fix_by; new.fix_by_email := old.fix_by_email; new.fix_at := old.fix_at;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_code_c_cases on public.code_c_cases;
create trigger trg_guard_code_c_cases
  before insert or update on public.code_c_cases
  for each row execute function public.guard_code_c_cases();

-- 4) My job: ใครดูแลสิทธิไหน (1 สิทธิ = 1 ผู้ดูแล; 1 คนดูแลได้หลายสิทธิ) ---------------
create table if not exists public.coverage_assignments (
  coverage_code text primary key references public.coverage_master(coverage_code) on delete cascade,
  user_id       uuid not null references public.app_users(id) on delete cascade,
  user_email    text,
  created_at    timestamptz not null default now()
);
create index if not exists coverage_assignments_user_idx on public.coverage_assignments(user_id);

-- เผื่อ environment เก่าที่เคยสร้าง PK แบบ (coverage_code, user_id): ลดเหลือผู้ดูแลคนเดียวต่อสิทธิ
-- (เก็บคนที่ได้สิทธิก่อน) แล้วเปลี่ยน PK เป็น coverage_code ตัวเดียว — production ปัจจุบันเป็นแบบนี้อยู่แล้ว จึงไม่ทำอะไร
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.coverage_assignments'::regclass and contype = 'p' and array_length(conkey, 1) > 1
  ) then
    delete from public.coverage_assignments a
      using public.coverage_assignments b
     where a.coverage_code = b.coverage_code
       and (a.created_at, a.user_id) > (b.created_at, b.user_id);
    alter table public.coverage_assignments drop constraint coverage_assignments_pkey;
    alter table public.coverage_assignments add primary key (coverage_code);
  end if;
end $$;

alter table public.coverage_assignments enable row level security;

drop policy if exists "read coverage_assignments"   on public.coverage_assignments;
drop policy if exists "insert coverage_assignments" on public.coverage_assignments;
drop policy if exists "delete coverage_assignments" on public.coverage_assignments;
create policy "read coverage_assignments" on public.coverage_assignments for select to authenticated using (true);
-- admin จัดการแทนใครก็ได้ | user จัดการได้เฉพาะของตัวเอง | audit / viewer ทำไม่ได้
create policy "insert coverage_assignments" on public.coverage_assignments for insert to authenticated
  with check (public.is_admin() or (user_id = auth.uid() and public.my_role() = 'user'));
create policy "delete coverage_assignments" on public.coverage_assignments for delete to authenticated
  using (public.is_admin() or (user_id = auth.uid() and public.my_role() = 'user'));

create or replace function public.fill_assignment_email()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  select email into new.user_email from public.app_users where id = new.user_id;
  return new;
end $$;
drop trigger if exists trg_fill_assignment_email on public.coverage_assignments;
create trigger trg_fill_assignment_email
  before insert on public.coverage_assignments
  for each row execute function public.fill_assignment_email();

-- บันทึก "สิทธิที่ฉันดูแล" ทั้งชุด (แทนที่ของเดิม) — SECURITY INVOKER จึงผ่าน RLS ด้านบน
-- คืนค่า = รายการสิทธิที่ "จองไม่สำเร็จ" เพราะมีคนอื่นดูแลอยู่แล้ว (array ว่าง = สำเร็จทั้งหมด)
drop function if exists public.set_my_coverages(text[]);
create function public.set_my_coverages(codes text[])
returns text[] language plpgsql security invoker set search_path to 'public' as $$
declare
  want text[] := coalesce(codes, '{}');
begin
  delete from public.coverage_assignments
   where user_id = auth.uid() and not (coverage_code = any (want));

  insert into public.coverage_assignments (coverage_code, user_id)
    select c, auth.uid() from unnest(want) as c
    on conflict (coverage_code) do nothing;

  return coalesce((
    select array_agg(c) from unnest(want) as c
     where not exists (select 1 from public.coverage_assignments
                        where coverage_code = c and user_id = auth.uid())
  ), '{}');
end $$;
