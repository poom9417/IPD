-- เปิดให้ admin "เลือกสิทธิให้ผู้อื่น" ได้ (เดิม audit / developer)
-- แก้ assign_responsibilities และ cancel_assignment_requests (admin ยกเลิกคำขอที่รอยืนยันได้ด้วย)
-- รันซ้ำได้ (idempotent)
do $$
declare
  fn text;
  def text;
begin
  foreach fn in array array['assign_responsibilities', 'cancel_assignment_requests'] loop
    select pg_get_functiondef(p.oid) into def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn;
    if def is null then
      raise exception 'ไม่พบฟังก์ชัน %', fn;
    end if;
    def := replace(def, '(''audit'', ''developer'')', '(''audit'', ''admin'', ''developer'')');
    def := replace(def, 'เฉพาะ Audit และ Developer เท่านั้นที่เลือกสิทธิให้ผู้อื่นได้', 'เฉพาะ Audit, Admin และ Developer เท่านั้นที่เลือกสิทธิให้ผู้อื่นได้');
    def := replace(def, 'เฉพาะ Audit และ Developer เท่านั้น', 'เฉพาะ Audit, Admin และ Developer เท่านั้น');
    execute def;
  end loop;
end $$;
