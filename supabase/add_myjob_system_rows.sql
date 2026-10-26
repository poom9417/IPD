-- ============================================================================
-- myjob_system_rows(): ข้อมูลเคสที่จำหน่ายแล้ว "ทั้งระบบ" แบบกะทัดรัด สำหรับ My job > Dashboard (โหมดดูทั้งระบบ)
-- เฉพาะ admin / developer (เช็ค is_admin() ในฟังก์ชัน)
-- ใช้ 1 คำสั่ง (เหมือน ar_summary_rows) แทนการดึงหลายหน้า + join patients_v → ไม่ชน statement_timeout
-- แต่ละแถว = [admission_id, encounter_id, an, hn, full_name, coverage_code, payer_id,
--             discharge_date, document_received_date, audit_date, submission_date]
-- รันซ้ำได้ (idempotent)
-- ============================================================================

create or replace function public.myjob_system_rows()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_array(
             a.admission_id, a.encounter_id, a.an, a.hn, p.full_name,
             a.coverage_code, a.payer_id, a.discharge_date,
             ct.document_received_date, ct.audit_date, ct.submission_date)), '[]'::jsonb)
    from admissions a
    left join patients p on p.hn = a.hn
    left join case_tracking ct on ct.admission_id = a.admission_id
    where a.discharge_date is not null
  );
end;
$$;

revoke execute on function public.myjob_system_rows() from public, anon;
grant  execute on function public.myjob_system_rows() to authenticated, service_role;

-- ROLLBACK: drop function if exists public.myjob_system_rows();
