-- role audit: ใช้ได้เฉพาะหน้าหลัก (ดู/Export) และหน้า Code C (ตอบช่องการแก้ไข)
--  1) audit บันทึกวัน Audit ใน case_tracking ไม่ได้อีก (หน้าหลักไม่มีปุ่ม/อัพโหลดวัน Audit แล้ว)
--  2) การเลือกสิทธิ (My claim) ให้ผู้อื่น เหลือเฉพาะ developer
-- รันซ้ำได้ (idempotent)

-- 1) case_tracking: ตัด audit ออกจากสิทธิ์เขียน
drop policy if exists "editor insert case_tracking" on public.case_tracking;
create policy "editor insert case_tracking" on public.case_tracking
  for insert to authenticated
  with check (public.my_role() = any (array['admin', 'developer', 'user']));

drop policy if exists "editor update case_tracking" on public.case_tracking;
create policy "editor update case_tracking" on public.case_tracking
  for update to authenticated
  using (public.my_role() = any (array['admin', 'developer', 'user']))
  with check (public.my_role() = any (array['admin', 'developer', 'user']));

-- 2) ฟังก์ชันเลือกสิทธิให้ผู้อื่น: ('audit', 'developer') → ('developer')
do $$
declare
  fn text;
  def text;
begin
  foreach fn in array array['assign_responsibilities', 'cancel_assignment_requests', 'list_assignable_users'] loop
    select pg_get_functiondef(p.oid) into def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn;
    if def is null then
      raise exception 'ไม่พบฟังก์ชัน %', fn;
    end if;
    def := replace(def, '(''audit'', ''developer'')', '(''developer'')');
    def := replace(def, 'เฉพาะ Audit และ Developer เท่านั้น', 'เฉพาะ Developer เท่านั้น');
    execute def;
  end loop;
end $$;
