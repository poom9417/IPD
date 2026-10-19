-- Code C รายแถวรหัส: เพิ่มสถานะ "ผ่านแล้ว" (ปุ่ม "ผ่านการแก้ C") ให้ตรงกับตาราง code_c_items
-- รันใน Supabase SQL Editor (ครั้งเดียว) ก่อน push หน้าเว็บ
-- ต้องรันหลัง migration code_c_items_per_code_rows (รันไปแล้วบนโปรเจกต์จริง)

alter table public.code_c_items
  add column if not exists passed_by uuid,
  add column if not exists passed_by_email text,
  add column if not exists passed_at timestamptz;
alter table public.code_c_items drop constraint if exists code_c_items_status_check;
alter table public.code_c_items add constraint code_c_items_status_check check (status in ('pending','answered','passed'));

drop function if exists public.code_c_pass(bigint);

create or replace function public.guard_code_c_items()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  r text := public.my_role();
  em text := public.my_email();
  reopen boolean := coalesce(current_setting('app.code_c_reopen', true), '') = '1';
  ack boolean := coalesce(current_setting('app.code_c_ack', true), '') = '1';
  pass boolean := coalesce(current_setting('app.code_c_pass', true), '') = '1';
begin
  if tg_op = 'INSERT' then
    new.seq := coalesce((select max(seq) from public.code_c_items where case_id = new.case_id), 0) + 1;
    new.added_by := auth.uid(); new.added_by_email := em; new.added_at := now();
    new.status := 'pending'; new.round_no := 1;
    new.fix_detail := null; new.fix_by := null; new.fix_by_email := null; new.fix_at := null; new.user_ack_at := null;
    new.passed_by := null; new.passed_by_email := null; new.passed_at := null;
    new.code := nullif(btrim(coalesce(new.code, '')), ''); new.reason := nullif(btrim(coalesce(new.reason, '')), '');
    if new.code_type is null or new.code is null or new.reason is null then
      raise exception 'ต้องระบุชนิดรหัส รหัส และสาเหตุที่ติด C ให้ครบ';
    end if;
    return new;
  end if;

  if new.case_id is distinct from old.case_id then
    raise exception 'ย้ายแถวไปเคสอื่นไม่ได้';
  end if;
  new.seq := old.seq; new.added_by := old.added_by; new.added_by_email := old.added_by_email; new.added_at := old.added_at;
  new.user_ack_at := old.user_ack_at;
  new.passed_by := old.passed_by; new.passed_by_email := old.passed_by_email; new.passed_at := old.passed_at;

  -- user รับทราบการแจ้งเตือน (เปลี่ยนได้แค่ user_ack_at)
  if ack then
    new.code_type := old.code_type; new.code := old.code; new.reason := old.reason;
    new.status := old.status; new.round_no := old.round_no;
    new.fix_detail := old.fix_detail; new.fix_by := old.fix_by; new.fix_by_email := old.fix_by_email; new.fix_at := old.fix_at;
    new.user_ack_at := now();
    return new;
  end if;

  -- "ผ่านการแก้ C" (สถานะสุดท้าย, ผ่าน code_c_pass เท่านั้น)
  if pass then
    if coalesce(r, '') not in ('user', 'developer') then
      raise exception 'เฉพาะ user เท่านั้นที่กด "ผ่านการแก้ C" ได้';
    end if;
    if old.status <> 'answered' then
      raise exception 'กด "ผ่านการแก้ C" ได้เฉพาะรหัสที่ Audit ตอบแล้ว';
    end if;
    new.code_type := old.code_type; new.code := old.code; new.reason := old.reason; new.round_no := old.round_no;
    new.fix_detail := old.fix_detail; new.fix_by := old.fix_by; new.fix_by_email := old.fix_by_email; new.fix_at := old.fix_at;
    new.status := 'passed'; new.passed_by := auth.uid(); new.passed_by_email := em; new.passed_at := now();
    insert into public.code_c_history(case_id, item_id, round_no, kind, body, by_uid, by_email)
    values (old.case_id, old.id, old.round_no, 'pass', null, auth.uid(), em);
    return new;
  end if;

  -- "ไม่ผ่านการแก้ C" (ผ่าน code_c_reopen เท่านั้น)
  if reopen then
    if coalesce(r, '') not in ('user', 'developer') then
      raise exception 'เฉพาะ user เท่านั้นที่กด "ไม่ผ่านการแก้ C" ได้';
    end if;
    if old.status <> 'answered' then
      raise exception 'รหัสนี้ยังรอ Audit แก้ไขอยู่ หรือปิดเป็น "ผ่านแล้ว" ไปแล้ว';
    end if;
    insert into public.code_c_history(case_id, item_id, round_no, kind, body, by_uid, by_email)
    values (old.case_id, old.id, old.round_no, 'reopen', nullif(btrim(coalesce(current_setting('app.code_c_note', true), '')), ''), auth.uid(), em);
    new.code_type := old.code_type; new.code := old.code; new.reason := old.reason;
    new.status := 'pending'; new.round_no := old.round_no + 1;
    new.fix_detail := null; new.fix_by := null; new.fix_by_email := null; new.fix_at := null;
    return new;
  end if;

  if coalesce(r, '') not in ('admin', 'developer', 'audit') then
    raise exception 'ไม่มีสิทธิ์แก้ไขแถว Code C นี้';
  end if;
  new.round_no := old.round_no;

  if r = 'audit' and (new.code_type is distinct from old.code_type or new.code is distinct from old.code or new.reason is distinct from old.reason) then
    raise exception 'role audit ตอบได้เฉพาะช่องการแก้ไข';
  end if;

  -- ผ่านแล้ว = สถานะสุดท้าย: แก้ช่องคำตอบไม่ได้ (admin/developer แก้ชนิดรหัส/รหัส/สาเหตุได้ เพื่อจัดข้อมูลเก่า)
  if old.status = 'passed' then
    if new.fix_detail is distinct from old.fix_detail then
      raise exception 'แถวนี้ผ่านแล้ว เป็นสถานะสุดท้าย แก้คำตอบไม่ได้';
    end if;
    new.status := 'passed';
    new.fix_by := old.fix_by; new.fix_by_email := old.fix_by_email; new.fix_at := old.fix_at;
  end if;

  if new.code_type is distinct from old.code_type or new.code is distinct from old.code or new.reason is distinct from old.reason then
    insert into public.code_c_history(case_id, item_id, round_no, kind, body, prev_body, by_uid, by_email)
    values (old.case_id, old.id, old.round_no, 'reason',
            public.code_c_item_label(new.code_type, new.code, new.reason),
            public.code_c_item_label(old.code_type, old.code, old.reason), auth.uid(), em);
  end if;

  if old.status = 'passed' then
    return new;
  end if;

  if new.fix_detail is distinct from old.fix_detail then
    if nullif(btrim(coalesce(new.fix_detail, '')), '') is null then
      if old.fix_detail is not null then
        insert into public.code_c_history(case_id, item_id, round_no, kind, body, prev_body, by_uid, by_email)
        values (old.case_id, old.id, old.round_no, 'edit', null, old.fix_detail, auth.uid(), em);
      end if;
      new.fix_detail := null; new.fix_by := null; new.fix_by_email := null; new.fix_at := null;
    elsif old.fix_detail is null then
      new.fix_by := auth.uid(); new.fix_by_email := em; new.fix_at := now();
      insert into public.code_c_history(case_id, item_id, round_no, kind, body, by_uid, by_email)
      values (old.case_id, old.id, old.round_no, 'answer', new.fix_detail, auth.uid(), em);
    else
      new.fix_by := old.fix_by; new.fix_by_email := old.fix_by_email; new.fix_at := old.fix_at;
      insert into public.code_c_history(case_id, item_id, round_no, kind, body, prev_body, by_uid, by_email)
      values (old.case_id, old.id, old.round_no, 'edit', new.fix_detail, old.fix_detail, auth.uid(), em);
    end if;
  else
    new.fix_by := old.fix_by; new.fix_by_email := old.fix_by_email; new.fix_at := old.fix_at;
  end if;

  new.status := case when new.fix_detail is null then 'pending' else 'answered' end;
  return new;
end $$;

create or replace function public.code_c_pass(p_item_id bigint)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(public.my_role(), '') not in ('user', 'developer') then
    raise exception 'เฉพาะ user เท่านั้นที่กด "ผ่านการแก้ C" ได้';
  end if;
  perform set_config('app.code_c_pass', '1', true);
  update public.code_c_items set status = status where id = p_item_id;
  perform set_config('app.code_c_pass', '0', true);
end $$;
revoke all on function public.code_c_pass(bigint) from public, anon;
grant execute on function public.code_c_pass(bigint) to authenticated;

-- แจ้งเตือนรายแถว: ปิด popup 1 รหัส = รับทราบเฉพาะรหัสนั้น (ของที่ตัวเองเป็นคนแจ้ง)
create or replace function public.code_c_ack_item(p_item_id bigint)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform set_config('app.code_c_ack', '1', true);
  update public.code_c_items set user_ack_at = now()
   where id = p_item_id and added_by = auth.uid() and status = 'answered';
  perform set_config('app.code_c_ack', '0', true);
end $$;
revoke all on function public.code_c_ack_item(bigint) from public, anon;
grant execute on function public.code_c_ack_item(bigint) to authenticated;
