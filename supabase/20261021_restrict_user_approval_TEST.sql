-- ชุดทดสอบ (ปลอดภัย): รันหลัง migration ใน SQL Editor
-- จำลองแต่ละ role ด้วย JWT claim แล้ว ROLLBACK ทุกอย่างด้วยการ raise exception ตอนท้าย ไม่มีข้อมูลเปลี่ยนจริง
-- ผลลัพธ์จะอยู่ในข้อความ error บรรทัดสุดท้าย "TEST RESULT: ..." (ไม่ใช่ error จริง)
-- ผลที่ถูกต้อง: T1..T10 ต้องเป็นตามที่ระบุ "คาดหวัง"

do $$
declare
  res text := '';
  v_admin uuid; v_audit uuid; v_dev uuid; v_user uuid; v_target uuid;
  n int;

begin
  select id into v_admin  from public.app_users where role = 'admin'     and approval_status = 'approved' limit 1;
  select id into v_audit  from public.app_users where role = 'audit'     and approval_status = 'approved' limit 1;
  select id into v_dev    from public.app_users where role = 'developer' limit 1;
  select id into v_user   from public.app_users where role = 'user'      and approval_status = 'approved' limit 1;
  select id into v_target from public.app_users where role = 'user'      and id <> v_user limit 1;

  set local role authenticated;

  -- T1 admin เรียก set_user_approval  (คาดหวัง: DENIED)
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  begin perform public.set_user_approval(v_target, 'rejected', null); res := res || 'T1 admin approve: ALLOWED(ผิด); ';
  exception when others then res := res || 'T1 admin approve: DENIED(ถูก); '; end;

  -- T2 admin update app_users ตรง  (คาดหวัง: 0 แถว)
  update public.app_users set unit = 'x' where id = v_target;
  get diagnostics n = row_count;
  res := res || 'T2 admin direct update rows=' || n || ' (คาดหวัง 0); ';

  -- T3 admin อ่านรายชื่อผู้ใช้ (คาดหวัง: เห็นแค่แถวตัวเอง = 1)
  select count(*) into n from public.app_users;
  res := res || 'T3 admin sees users=' || n || ' (คาดหวัง 1); ';

  -- T4 user ทั่วไป เรียก set_user_approval  (คาดหวัง: DENIED)
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  begin perform public.set_user_approval(v_target, 'rejected', null); res := res || 'T4 user approve: ALLOWED(ผิด); ';
  exception when others then res := res || 'T4 user approve: DENIED(ถูก); '; end;

  -- T5 audit อนุมัติโดยไม่กำหนด role  (คาดหวัง: ALLOWED)
  perform set_config('request.jwt.claims', json_build_object('sub', v_audit, 'role', 'authenticated')::text, true);
  begin perform public.set_user_approval(v_target, 'approved', null); res := res || 'T5 audit approve (no role): ALLOWED(ถูก); ';
  exception when others then res := res || 'T5 audit approve (no role): DENIED(ผิด: ' || sqlerrm || '); '; end;

  -- T6 audit กำหนด role ผ่านฟังก์ชัน (user และ admin)  (คาดหวัง: DENIED ทั้งคู่)
  begin perform public.set_user_approval(v_target, 'approved', 'user'); res := res || 'T6a audit set role user: ALLOWED(ผิด); ';
  exception when others then res := res || 'T6a audit set role user: DENIED(ถูก); '; end;
  begin perform public.set_user_approval(v_target, 'approved', 'admin'); res := res || 'T6b audit set role admin: ALLOWED(ผิด); ';
  exception when others then res := res || 'T6b audit set role admin: DENIED(ถูก); '; end;

  -- T7 audit แก้ approval_status / role ตรงที่ตาราง  (คาดหวัง: DENIED ทั้งหมด)
  begin update public.app_users set approval_status = 'approved' where id = v_target; res := res || 'T7a audit direct approval: ALLOWED(ผิด); ';
  exception when others then res := res || 'T7a audit direct approval: DENIED(ถูก); '; end;
  begin update public.app_users set role = 'user' where id = v_target; res := res || 'T7b audit direct role: ALLOWED(ผิด); ';
  exception when others then res := res || 'T7b audit direct role: DENIED(ถูก); '; end;

  -- T8 audit เปลี่ยน role ของตัวเอง  (คาดหวัง: DENIED)
  begin update public.app_users set role = 'viewer' where id = v_audit; res := res || 'T8 audit self role: ALLOWED(ผิด); ';
  exception when others then res := res || 'T8 audit self role: DENIED(ถูก); '; end;

  -- T9 audit แก้หน่วยงาน / อ่านรายชื่อ  (คาดหวัง: ALLOWED / เห็นทั้งหมด)
  begin update public.app_users set unit = 'ทดสอบ' where id = v_target; res := res || 'T9a audit unit: ALLOWED(ถูก); ';
  exception when others then res := res || 'T9a audit unit: DENIED(ผิด); '; end;
  select count(*) into n from public.app_users;
  res := res || 'T9b audit sees users=' || n || ' (คาดหวัง 10); ';

  -- T10 developer ตั้ง role admin  (คาดหวัง: ALLOWED)
  perform set_config('request.jwt.claims', json_build_object('sub', v_dev, 'role', 'authenticated')::text, true);
  begin perform public.set_user_approval(v_target, 'approved', 'admin'); res := res || 'T10 developer grant admin: ALLOWED(ถูก); ';
  exception when others then res := res || 'T10 developer grant admin: DENIED(ผิด: ' || sqlerrm || '); '; end;

  reset role;
  raise exception 'TEST RESULT: %', res;
end $$;
