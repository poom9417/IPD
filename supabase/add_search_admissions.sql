-- ============================================================================
-- Dashboard: ดึงข้อมูลทีละหน้า (เรียงวันจำหน่ายใหม่ -> เก่า) + ค้นหา/กรอง/สรุปตัวเลขที่ฝั่ง DB
-- migration: add_search_admissions  (รันซ้ำได้)
-- ============================================================================

-- index ให้ตรงกับการเรียงของหน้า Dashboard
create index if not exists idx_admissions_discharge_desc
  on public.admissions (discharge_date desc nulls last, discharge_time desc nulls last, admission_id desc);

create or replace function public.search_admissions(
  p_search      text    default null,   -- HN / ชื่อ / encounter_id / AN (ค้นแบบมีคำนี้อยู่ในข้อความ ไม่สนตัวพิมพ์)
  p_division    text    default null,
  p_from        date    default null,   -- วันจำหน่ายเริ่มต้น (ถ้าเลือกวันเดียว ให้ส่ง from = to)
  p_to          date    default null,
  p_coverages   text[]  default null,   -- เลือกหลายสิทธิ
  p_payer       text    default null,
  p_stage       text    default null,   -- pending_doc | pending_audit | pending_submit | submitted
  p_pairs       text[]  default null,   -- 'สิทธิ|ผู้จ่าย' ของ "เฉพาะสิทธิของฉัน" (null = ไม่กรอง)
  p_limit       int     default 50,
  p_offset      int     default 0,
  p_with_stats  boolean default true    -- false = ไม่คิดตัวเลขสรุป/รายการหอ (ใช้ตอน Export ดึงทีละก้อน)
) returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_pat    text;
  v_limit  int := least(greatest(coalesce(p_limit, 50), 1), 1000);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  if nullif(btrim(coalesce(p_search, '')), '') is not null then
    v_pat := '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return (
    with f as materialized (
      select a.admission_id, a.encounter_id, a.payer_id, a.hn, a.los,
             ct.document_received_amount
      from admissions a
      left join patients p       on p.hn = a.hn
      left join case_tracking ct on ct.admission_id = a.admission_id
      where (v_pat is null
             or a.hn ilike v_pat
             or p.full_name ilike v_pat
             or a.encounter_id::text ilike v_pat
             or a.an::text ilike v_pat)
        and (coalesce(p_division, '') = '' or a.division_code = p_division)
        and (p_from is null or a.discharge_date >= p_from)
        and (p_to   is null or a.discharge_date <= p_to)
        and (p_coverages is null or cardinality(p_coverages) = 0 or a.coverage_code = any (p_coverages))
        and (coalesce(p_payer, '') = '' or a.payer_id = p_payer)
        and (p_pairs is null
             or (coalesce(a.coverage_code, '') || '|' || coalesce(a.payer_id, '')) = any (p_pairs))
        and (coalesce(p_stage, '') = ''
             or p_stage = case
                  when ct.submission_date        is not null then 'submitted'
                  when ct.audit_date             is not null then 'pending_submit'
                  when ct.document_received_date is not null then 'pending_audit'
                  else 'pending_doc'
                end)
    ),
    pg as (
      select a.*
      from admissions a
      join f using (admission_id)
      order by a.discharge_date desc nulls last, a.discharge_time desc nulls last, a.admission_id desc
      limit v_limit offset v_offset
    ),
    enc as (  -- 1 เคส = encounter_id + payer (เหมือนที่ Stat cards นับเดิม)
      select distinct on (encounter_id, coalesce(payer_id, '')) los
      from f
      where p_with_stats
      order by encounter_id, coalesce(payer_id, ''), admission_id
    )
    select jsonb_build_object(
      'total', (select count(*) from f),
      'grand_total', (select count(*) from admissions),
      'rows', (
        select coalesce(jsonb_agg(
          to_jsonb(pg) || jsonb_build_object(
            'patients',        (select to_jsonb(p)  from patients p         where p.hn = pg.hn),
            'coverage_master', (select to_jsonb(c)  from coverage_master c  where c.coverage_code = pg.coverage_code),
            'payer_master',    (select to_jsonb(py) from payer_master py    where py.payer_id = pg.payer_id),
            'case_tracking',   (select to_jsonb(ct) from case_tracking ct   where ct.admission_id = pg.admission_id)
          )
          order by pg.discharge_date desc nulls last, pg.discharge_time desc nulls last, pg.admission_id desc
        ), '[]'::jsonb)
        from pg
      ),
      'stats', case when p_with_stats then jsonb_build_object(
        'cases',          (select count(*) from enc),
        'avg_los',        (select case when count(*) = 0 then 0
                                       else round(sum(coalesce(los, 0))::numeric / count(*), 1) end from enc),
        'patients',       (select count(distinct hn) from f),
        'received_total', (select coalesce(sum(document_received_amount), 0) from f),
        'received_count', (select count(document_received_amount) from f)
      ) end,
      'divisions', case when p_with_stats then (
        select coalesce(jsonb_agg(d.division_code order by d.division_code), '[]'::jsonb)
        from (select distinct division_code from admissions where division_code is not null) d
      ) end
    )
  );
end;
$$;

revoke execute on function public.search_admissions(text, text, date, date, text[], text, text, text[], int, int, boolean) from public, anon;
grant  execute on function public.search_admissions(text, text, date, date, text[], text, text, text[], int, int, boolean) to authenticated, service_role;

-- ROLLBACK:
-- drop function if exists public.search_admissions(text, text, date, date, text[], text, text, text[], int, int, boolean);
-- drop index if exists public.idx_admissions_discharge_desc;
