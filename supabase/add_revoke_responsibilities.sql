-- ถอนสิทธิที่ถูกรับแล้ว (My claim) — เฉพาะ admin / developer
--  • ถอน = ลบแถวใน coverage_assignments (ข้อมูลเคส case_tracking ไม่ถูกแตะ)
--  • ถ้าเลือกผู้รับใหม่ → สร้างคำขอ assignment_requests (ผู้รับต้องกดยืนยันที่หน้าหลัก)
--  • ถ้าไม่เลือกผู้รับ → สิทธิกลับเป็น "ว่าง"
--  • list_assignable_users เปิดให้ admin ใช้ได้ด้วย (ใช้ดึงรายชื่อผู้รับในโหมดถอนสิทธิ)
-- รันซ้ำได้ (idempotent)

create or replace function public.revoke_responsibilities(pairs jsonb, p_user uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  want      jsonb := coalesce(pairs, '[]'::jsonb);
  me_email  text;
  me_role   text;
  tgt_email text;
  tgt_role  text;
  w         record;
  revoked   int := 0;
  requested int := 0;
  refused   jsonb := '[]'::jsonb;
  gone      int;
begin
  if not public.is_approved() then raise exception 'บัญชียังไม่ได้รับอนุมัติ'; end if;
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select u.email, u.role into me_email, me_role from public.app_users u where u.id = auth.uid();
  if coalesce(me_role, '') not in ('admin', 'developer') then
    raise exception 'เฉพาะ Admin และ Developer เท่านั้นที่ถอนสิทธิได้';
  end if;

  if p_user is not null then
    select u.email, u.role into tgt_email, tgt_role from public.app_users u where u.id = p_user;
    if tgt_email is null or tgt_role not in ('admin', 'user', 'developer') then
      raise exception 'ผู้รับต้องเป็นผู้ใช้ที่มีหน้า My job (admin / user)';
    end if;
  end if;

  for w in select * from jsonb_to_recordset(want) as x(coverage_code text, payer_id text) loop
    delete from public.coverage_assignments c
     where c.coverage_code = w.coverage_code and c.payer_id = w.payer_id;
    get diagnostics gone = row_count;

    if gone = 0 then
      refused := refused || jsonb_build_array(jsonb_build_object(
        'coverage_code', w.coverage_code, 'payer_id', w.payer_id, 'reason', 'ไม่มีผู้ดูแลอยู่แล้ว'));
      continue;
    end if;
    revoked := revoked + 1;

    if p_user is not null then
      begin
        insert into public.assignment_requests
          (coverage_code, payer_id, user_id, user_email, assigned_by, assigned_by_email, assigned_by_role)
        values
          (w.coverage_code, w.payer_id, p_user, tgt_email, auth.uid(), me_email, me_role);
        requested := requested + 1;
      exception when unique_violation then
        refused := refused || jsonb_build_array(jsonb_build_object(
          'coverage_code', w.coverage_code, 'payer_id', w.payer_id,
          'reason', 'ถอนแล้ว แต่ส่งคำขอไม่ได้ (มีคำขอรอยืนยันอยู่)'));
      end;
    end if;
  end loop;

  return jsonb_build_object('revoked', revoked, 'requested', requested, 'refused', refused);
end $$;

revoke all on function public.revoke_responsibilities(jsonb, uuid) from public, anon;
grant execute on function public.revoke_responsibilities(jsonb, uuid) to authenticated;

-- รายชื่อผู้รับ: เปิดให้ admin ใช้ด้วย
create or replace function public.list_assignable_users()
returns table(id uuid, email text, unit text, role text)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if coalesce(public.my_role(), '') not in ('audit', 'admin', 'developer') then
    raise exception 'เฉพาะ Audit, Admin และ Developer เท่านั้น';
  end if;
  return query
    select u.id, u.email, u.unit, u.role
      from public.app_users u
     where u.role in ('admin', 'user', 'developer')
     order by u.email;
end $$;
