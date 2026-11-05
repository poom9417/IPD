-- ============================================================================
-- 2026-11-05: (3 ฟังก์ชัน: ar_summary_rows, myjob_system_rows, ar_pending_admissions) นับ "ค้างส่งเบิก" จากการไม่มี claim_no (เลขตั้งเบิก)
-- ส่ง claim_no เพิ่มต่อท้ายอาร์เรย์ของ 2 ฟังก์ชัน (ตำแหน่งเดิมไม่ขยับ → โค้ดเก่าไม่พัง)
--   ar_summary_rows()    : [coverage_code, payer_id, discharge_date, submission_date, amount, claim_no]
--   myjob_system_rows()  : [admission_id, encounter_id, an, hn, full_name, coverage_code, payer_id,
--                           discharge_date, document_received_date, audit_date, submission_date, claim_no]
-- รันซ้ำได้ (idempotent)
-- ============================================================================

create or replace function public.ar_summary_rows()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_amt boolean;
begin
  if not public.is_approved() then
    return '[]'::jsonb;
  end if;
  v_amt := public.can_see_amounts();

  return (
    select coalesce(jsonb_agg(jsonb_build_array(
             a.coverage_code, a.payer_id, a.discharge_date, ct.submission_date,
             case when v_amt then ct.document_received_amount end,
             nullif(trim(ct.claim_no), ''))), '[]'::jsonb)
    from admissions a
    left join case_tracking ct on ct.admission_id = a.admission_id
  );
end;
$$;

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
             ct.document_received_date, ct.audit_date, ct.submission_date,
             nullif(trim(ct.claim_no), ''))), '[]'::jsonb)
    from admissions a
    left join patients p on p.hn = a.hn
    left join case_tracking ct on ct.admission_id = a.admission_id
    where a.discharge_date is not null
  );
end;
$$;

-- ar_pending_admissions(p_asof): ใช้กับชีต "รายการที่ค้าง" ของ Export — เงื่อนไขค้างต้องตรงกับ classifyRow ฝั่งเว็บ
create or replace function public.ar_pending_admissions(p_asof date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_names boolean := public.can_see_names();
  v_birth boolean := public.can_see_birthdate();
  v_amt   boolean := public.can_see_amounts();
begin
  if not public.is_approved() then
    raise exception 'ไม่ได้รับอนุญาต';
  end if;
  if p_asof is null then
    return '[]'::jsonb;
  end if;

  return (
    with pg as (
      select a.*
      from admissions a
      left join case_tracking ct on ct.admission_id = a.admission_id
      where a.discharge_date is not null
        and a.discharge_date <= p_asof
        -- ค้าง = ไม่มี claim_no หรือ (มี claim_no แต่วันส่งเบิกเกินวันที่เลือก)
        and (coalesce(trim(ct.claim_no), '') = '' or ct.submission_date > p_asof)
        and a.coverage_code <> 'UNK'
        and a.coverage_code not like 'DIS\_%'
    )
    select coalesce(jsonb_agg(
      to_jsonb(pg) || jsonb_build_object(
        'patients',        (select (to_jsonb(p) - 'full_name' - 'birthdate')
                                    || jsonb_build_object('full_name', case when v_names then p.full_name end,
                                                          'birthdate', case when v_birth then p.birthdate end)
                            from patients p where p.hn = pg.hn),
        'coverage_master', (select to_jsonb(c)  from coverage_master c  where c.coverage_code = pg.coverage_code),
        'payer_master',    (select to_jsonb(py) from payer_master py    where py.payer_id = pg.payer_id),
        'case_tracking',   (select (to_jsonb(ct) - 'document_received_amount' - 'submission_amount')
                                    || jsonb_build_object('document_received_amount', case when v_amt then ct.document_received_amount end,
                                                          'submission_amount',        case when v_amt then ct.submission_amount end)
                            from case_tracking ct where ct.admission_id = pg.admission_id)
      )
      order by pg.admission_id
    ), '[]'::jsonb)
    from pg
  );
end;
$$;

-- ROLLBACK: สร้างฟังก์ชันใหม่โดยตัด nullif(trim(ct.claim_no), '') ออกจากสองฟังก์ชันแรก (และ , ที่ตามหลังบรรทัดก่อนหน้า)
--           และใน ar_pending_admissions ให้เปลี่ยนเงื่อนไขกลับเป็น (ct.submission_date is null or ct.submission_date > p_asof)
