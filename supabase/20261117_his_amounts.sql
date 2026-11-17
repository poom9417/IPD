-- ============================================================================
-- IPD AR discharge — นำเข้า "ยอดเงินจาก HIS" แทน user ปกติ (admin / developer เท่านั้น)
--
--  1) guard_case_tracking_audit(): role "user" ห้ามเพิ่ม/แก้ document_received_amount
--     (user บันทึกได้แค่วันที่รับเอกสาร — ยอดมาจากไฟล์ HIS ที่ admin/developer นำเข้า)
--  2) import_his_amounts(p_rows jsonb, p_apply boolean)
--       p_apply = false → ตรวจ (dry-run) แล้วคืนผลรายแถวให้ดู preview
--       p_apply = true  → ตรวจซ้ำ แล้วบันทึกเฉพาะแถวสถานะ ok / ok_fallback
--     แต่ละแถวใน p_rows: { encounter_id, hn, coverage_code, payer_id, amount }
--     (amount = claimAmt + discount คำนวณฝั่งหน้าเว็บ)
--
--  กติกาจับคู่:  encounter_id + HN + สิทธิ(coverage) + ผู้จ่าย(payer; ว่าง = UNK)
--    - ok            : จับคู่ครบ และช่องยอดยังว่าง → บันทึก
--    - ok_fallback   : ไฟล์เป็น UNK แต่ในระบบเปลี่ยนสิทธิ/ผู้จ่ายไปแล้ว และ encounter+HN นี้มีแถวเดียว → บันทึก (แสดงเตือนใน preview)
--    - has_amount    : ช่องยอดมีค่าอยู่แล้ว → ข้าม (ไม่เขียนทับ)
--    - not_found     : ไม่พบ encounter นี้ในระบบ → ไม่บันทึก (แจ้งเตือน)
--    - mismatch      : พบ encounter แต่ HN/สิทธิ/ผู้จ่ายไม่ตรง → ไม่บันทึก (แจ้งเตือน)
--    - ambiguous     : ไฟล์เป็น UNK และ encounter นี้มีหลายสิทธิในระบบ → ไม่บันทึก (กันลงผิดแถว)
--    - dup_in_file   : key ซ้ำในไฟล์ → ใช้แถวแรก ข้ามแถวที่ซ้ำ
--    - invalid / negative : ข้อมูลในไฟล์ไม่ถูกต้อง / ยอดติดลบ → ไม่บันทึก
--  ไม่แตะ document_received_date — สถานะยังเป็น "รอรับเอกสาร" ตามเดิม
-- รันซ้ำได้ (idempotent)
-- ============================================================================

-- 1) role user แก้ยอดไม่ได้ ------------------------------------------------
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
      if new.document_received_amount is not null then
        raise exception 'role user บันทึกยอดเงินจาก HIS ไม่ได้ (admin/developer นำเข้าจากไฟล์ HIS)';
      end if;
    else
      if new.audit_date is distinct from old.audit_date then
        raise exception 'role user แก้วันที่ Audit ไม่ได้ (เป็นงานของ role audit)';
      end if;
      if new.document_received_amount is distinct from old.document_received_amount then
        raise exception 'role user แก้ยอดเงินจาก HIS ไม่ได้ (admin/developer นำเข้าจากไฟล์ HIS)';
      end if;
    end if;
  end if;
  return new;
end $$;

-- 2) นำเข้ายอดจากไฟล์ HIS ---------------------------------------------------
create or replace function public.import_his_amounts(p_rows jsonb, p_apply boolean default false)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_out     jsonb := '[]'::jsonb;
  v_applied int   := 0;
  v_idx     int   := 0;
  r         jsonb;
  v_enc     bigint;
  v_hn      text;
  v_cov     text;
  v_pay     text;
  v_amt     numeric;
  v_key     text;
  v_seen    text[] := '{}';
  v_aid     bigint;
  v_scov    text;
  v_spay    text;
  v_old     numeric;
  v_status  text;
  v_note    text;
  v_cnt     int;
  v_enc_cnt int;
begin
  -- เฉพาะ admin / developer (is_admin() รวม developer) — เช็คฝั่ง DB ไม่พึ่งการซ่อนปุ่ม
  if not public.is_admin() then
    raise exception 'เฉพาะ admin / developer เท่านั้น';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'รูปแบบข้อมูลไม่ถูกต้อง';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'ไฟล์ใหญ่เกินไป (สูงสุด 5,000 แถวต่อครั้ง)';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_idx := v_idx + 1;
    v_status := null; v_note := null; v_aid := null; v_scov := null; v_spay := null; v_old := null;

    begin
      v_enc := nullif(trim(r->>'encounter_id'), '')::bigint;
      v_amt := nullif(trim(r->>'amount'), '')::numeric;
    exception when others then
      v_enc := null; v_amt := null;
    end;
    v_hn  := nullif(trim(r->>'hn'), '');
    v_cov := coalesce(nullif(trim(r->>'coverage_code'), ''), 'UNK');
    v_pay := coalesce(nullif(trim(r->>'payer_id'), ''), 'UNK');

    if v_enc is null or v_hn is null then
      v_status := 'invalid'; v_note := 'encounter_id / HN ไม่ถูกต้อง';
    elsif v_amt is null then
      v_status := 'invalid'; v_note := 'ยอดเงินไม่ถูกต้อง';
    elsif v_amt < 0 then
      v_status := 'negative'; v_note := 'ยอดติดลบ — ไม่บันทึก';
    else
      v_key := lower(v_enc::text || '|' || v_hn || '|' || v_cov || '|' || v_pay);
      if v_key = any (v_seen) then
        v_status := 'dup_in_file'; v_note := 'key ซ้ำในไฟล์ — ใช้แถวแรก';
      else
        v_seen := v_seen || v_key;

        -- 2.1 จับคู่ครบ 4 ตัว
        select a.admission_id, a.coverage_code, a.payer_id
          into v_aid, v_scov, v_spay
          from public.admissions a
         where a.encounter_id = v_enc
           and lower(trim(a.hn)) = lower(v_hn)
           and lower(a.coverage_code) = lower(v_cov)
           and lower(coalesce(nullif(a.payer_id, ''), 'UNK')) = lower(v_pay)
         limit 1;

        if v_aid is not null then
          v_status := 'ok';
        else
          -- 2.2 ไฟล์เป็น UNK (HIS ยังไม่รู้สิทธิ) แต่ในระบบแก้สิทธิไปแล้ว → จับด้วย encounter + HN ถ้ามีแถวเดียว
          select count(*) into v_cnt
            from public.admissions a
           where a.encounter_id = v_enc and lower(trim(a.hn)) = lower(v_hn);

          if lower(v_cov) = 'unk' and v_cnt = 1 then
            select a.admission_id, a.coverage_code, a.payer_id
              into v_aid, v_scov, v_spay
              from public.admissions a
             where a.encounter_id = v_enc and lower(trim(a.hn)) = lower(v_hn);
            v_status := 'ok_fallback';
            v_note := format('สิทธิในระบบ %s / %s (ไฟล์เป็น UNK)', v_scov, coalesce(nullif(v_spay, ''), 'UNK'));
          elsif lower(v_cov) = 'unk' and v_cnt > 1 then
            v_status := 'ambiguous';
            v_note := 'encounter นี้มีหลายสิทธิในระบบ ไฟล์เป็น UNK — ระบุแถวไม่ได้';
          else
            select count(*) into v_enc_cnt from public.admissions a where a.encounter_id = v_enc;
            if v_enc_cnt = 0 then
              v_status := 'not_found'; v_note := 'ไม่พบ encounter_id นี้ในระบบ';
            else
              v_status := 'mismatch';
              select string_agg(a.hn || ' / ' || a.coverage_code || ' / ' || coalesce(nullif(a.payer_id, ''), 'UNK'), ' ; ')
                into v_note
                from public.admissions a where a.encounter_id = v_enc;
              v_note := 'ไม่ตรงกับระบบ (HN / สิทธิ / ผู้จ่าย ในระบบ: ' || v_note || ')';
            end if;
          end if;
        end if;

        -- 2.3 จับคู่ได้ → เช็คว่ามียอดเดิมหรือยัง (มี = ข้าม ไม่เขียนทับ)
        if v_aid is not null then
          select ct.document_received_amount into v_old
            from public.case_tracking ct where ct.admission_id = v_aid;
          if v_old is not null then
            v_status := 'has_amount';
            v_note := 'มียอดเดิมอยู่แล้ว — ข้าม';
          elsif p_apply then
            insert into public.case_tracking as ct (admission_id, encounter_id, document_received_amount)
            values (v_aid, v_enc, v_amt)
            on conflict (admission_id) do update
              set document_received_amount = excluded.document_received_amount
              where ct.document_received_amount is null;
            v_applied := v_applied + 1;
          end if;
        end if;
      end if;
    end if;

    v_out := v_out || jsonb_build_object(
      'idx', v_idx,
      'encounter_id', v_enc,
      'hn', v_hn,
      'coverage_code', v_cov,
      'payer_id', v_pay,
      'amount', v_amt,
      'status', v_status,
      'admission_id', v_aid,
      'sys_coverage', v_scov,
      'sys_payer', v_spay,
      'old_amount', v_old,
      'note', v_note
    );
  end loop;

  return jsonb_build_object('rows', v_out, 'applied', v_applied);
end $$;

revoke execute on function public.import_his_amounts(jsonb, boolean) from public, anon;
grant  execute on function public.import_his_amounts(jsonb, boolean) to authenticated, service_role;

-- ROLLBACK:
--   drop function public.import_his_amounts(jsonb, boolean);
--   (แล้วรัน restrict_user_audit_fields.sql เวอร์ชันก่อนหน้าเพื่อคืน guard เดิม)
