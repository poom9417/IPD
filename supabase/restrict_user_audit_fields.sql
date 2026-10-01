-- ============================================================================
-- IPD AR discharge — role "user" ห้ามแตะ audit_date / audit_amount ใน case_tracking
-- (กันที่ฐานข้อมูล ไม่ใช่แค่ซ่อนปุ่มในหน้าเว็บ)
--   * audit  : แก้ได้เฉพาะ audit_date / audit_amount (เหมือนเดิม)
--   * user   : แก้ได้เฉพาะ รับเอกสาร / ส่งเบิก (วันที่, ยอด, claim_no) — audit_* ห้ามเปลี่ยน
--   * admin  : ไม่ถูกจำกัด
-- รันหลัง add_audit_codec_myjob.sql  (แทนที่ฟังก์ชัน guard_case_tracking_audit เดิม)
-- ============================================================================
create or replace function public.guard_case_tracking_audit()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  r text := public.my_role();
begin
  if r = 'audit' then
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

  elsif r = 'user' then
    if tg_op = 'INSERT' then
      if new.audit_date is not null or new.audit_amount is not null then
        raise exception 'role user บันทึกวันที่/ยอด Audit ไม่ได้ (เป็นงานของ role audit)';
      end if;
    else
      if new.audit_date   is distinct from old.audit_date
         or new.audit_amount is distinct from old.audit_amount then
        raise exception 'role user แก้วันที่/ยอด Audit ไม่ได้ (เป็นงานของ role audit)';
      end if;
    end if;
  end if;
  return new;
end $$;
-- trigger trg_guard_case_tracking_audit ผูกกับฟังก์ชันนี้อยู่แล้ว ไม่ต้องสร้างใหม่
