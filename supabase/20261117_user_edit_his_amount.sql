-- IPD AR discharge — ให้ role "user" แก้ "ยอดเงินจาก HIS" (document_received_amount) ได้
-- (ปรับ guard_case_tracking_audit(): role user ยังห้ามแก้วัน Audit เหมือนเดิม; audit ยังแก้ได้เฉพาะวัน Audit)
-- ถูกรันบน Supabase แล้ว (migration: allow_user_edit_his_amount) — เก็บไฟล์นี้ไว้เป็นประวัติ รันซ้ำได้
create or replace function public.guard_case_tracking_audit()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  r text := public.my_role();
begin
  if r = 'audit' then
    if tg_op = 'INSERT' then
      if new.document_received_date is not null or new.document_received_amount is not null
         or new.submission_date is not null or new.submission_amount is not null
         or new.claim_no is not null then
        raise exception 'role audit บันทึกได้เฉพาะวันที่ Audit';
      end if;
    else
      if new.document_received_date   is distinct from old.document_received_date
         or new.document_received_amount is distinct from old.document_received_amount
         or new.submission_date       is distinct from old.submission_date
         or new.submission_amount     is distinct from old.submission_amount
         or new.claim_no              is distinct from old.claim_no then
        raise exception 'role audit แก้ได้เฉพาะวันที่ Audit';
      end if;
    end if;

  elsif r = 'user' then
    if tg_op = 'INSERT' then
      if new.audit_date is not null then
        raise exception 'role user บันทึกวันที่ Audit ไม่ได้ (เป็นงานของ role audit)';
      end if;
    else
      if new.audit_date is distinct from old.audit_date then
        raise exception 'role user แก้วันที่ Audit ไม่ได้ (เป็นงานของ role audit)';
      end if;
    end if;
  end if;
  return new;
end $$;
