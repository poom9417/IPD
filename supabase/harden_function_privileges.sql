-- ============================================================================
-- ปิดช่องให้เรียกฟังก์ชัน SECURITY DEFINER ผ่าน /rest/v1/rpc โดยไม่จำเป็น
-- รันแล้วบน production เมื่อ 2026-10-01 (migration: harden_function_privileges)
-- เก็บไว้ใช้ตั้ง environment ใหม่ — รันหลัง add_user_role.sql และ add_audit_codec_myjob.sql
-- รันซ้ำได้ (idempotent)
-- ============================================================================

-- 1) trigger functions: ไม่มีใครต้องเรียกผ่าน API (trigger ไม่เช็คสิทธิ์ EXECUTE ตอนทำงาน)
revoke execute on function public.fill_assignment_email()      from public, anon, authenticated;
revoke execute on function public.guard_case_tracking_audit()  from public, anon, authenticated;
revoke execute on function public.guard_code_c_cases()         from public, anon, authenticated;
revoke execute on function public.handle_new_user()            from public, anon, authenticated;

-- 2) helper ที่ RLS policy เรียกใช้: "ต้อง" คงสิทธิ์ authenticated ไว้ (ถ้าเอาออก ทุก policy จะพัง)
--    เอาออกเฉพาะ anon / public
revoke execute on function public.is_admin()   from public, anon;
revoke execute on function public.is_editor()  from public, anon;
revoke execute on function public.my_role()    from public, anon;
revoke execute on function public.my_email()   from public, anon;
grant  execute on function public.is_admin()   to authenticated, service_role;
grant  execute on function public.is_editor()  to authenticated, service_role;
grant  execute on function public.my_role()    to authenticated, service_role;
grant  execute on function public.my_email()   to authenticated, service_role;

-- 3) import_admissions: เรียกจากหน้าเว็บโดย admin (ในฟังก์ชันเช็ค is_admin() อยู่แล้ว) — ปิด anon/public ให้ชัดเจน
revoke execute on function public.import_admissions(jsonb) from public, anon;
grant  execute on function public.import_admissions(jsonb) to authenticated, service_role;

-- 4) ตั้ง search_path ให้ฟังก์ชันที่ยังไม่ได้ตั้ง
alter function public.touch_case_tracking() set search_path = public;
alter function public._clean_txt(text)      set search_path = public;

-- ----------------------------------------------------------------------------
-- ROLLBACK (ถ้าเจอปัญหา ให้รันบล็อกนี้เพื่อคืนสิทธิ์เดิม)
-- grant execute on function public.fill_assignment_email()     to public, anon, authenticated;
-- grant execute on function public.guard_case_tracking_audit() to public, anon, authenticated;
-- grant execute on function public.guard_code_c_cases()        to public, anon, authenticated;
-- grant execute on function public.handle_new_user()           to public, anon, authenticated;
-- grant execute on function public.is_admin()                  to public, anon, authenticated;
-- grant execute on function public.is_editor()                 to public, anon, authenticated;
-- grant execute on function public.my_role()                   to public, anon, authenticated;
-- grant execute on function public.my_email()                  to public, anon, authenticated;
-- grant execute on function public.import_admissions(jsonb)    to public, anon, authenticated;
-- ----------------------------------------------------------------------------
