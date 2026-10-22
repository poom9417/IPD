// ส่งข้อมูลเคส (จำหน่ายตั้งแต่ 1 ต.ค. 2026 ไม่ใช่สิทธิ UNK และไม่ใช่สิทธิ DIS...) จากระบบ → แท็บ "ทะเบียนคุมเอกสารสิทธิ 70" ใน Google Sheet
// วิธีทำงาน: วางทับทั้งหมด (แถวหัวคงเดิม) เรียงวันจำหน่ายใหม่สุดอยู่บน — ระบบเป็นต้นฉบับ ชีตเป็นสำเนา
// เรียกซ้ำกี่ครั้งผลก็เหมือนเดิม (idempotent)
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders, errorResponse, HttpError, json, requireAdmin, saveState } from './common.ts'
import {
  batchUpdate,
  clearValues,
  findTab,
  getAccessToken,
  getValues,
  isoToSerial,
  listTabs,
  loadServiceAccount,
  loadSheetId,
  updateValues,
} from './google.ts'

const DATA_TAB = 'ทะเบียนคุมเอกสารสิทธิ 70'
const HEADERS = ['HN', 'AN', 'encounter_id', 'name', 'สิทธิ', 'payer', 'discharge_date']
const PAGE = 1000
// ระบบนี้ใกล้เลิกใช้: ส่งเฉพาะเคสที่จำหน่ายตั้งแต่วันนี้เป็นต้นไป (ปรับวันได้ที่นี่) ไม่ส่งเคสสิทธิ UNK และสิทธิที่ขึ้นต้นด้วย DIS
const MIN_DISCHARGE_DATE = '2026-10-01'

type Row = {
  admission_id: number
  hn: string
  an: number
  encounter_id: number
  coverage_code: string
  payer_id: string
  discharge_date: string | null
  patients: { full_name: string } | { full_name: string }[] | null
}

// ในชีตแสดงรหัสสิทธิแบบตัด "_" และทุกอย่างหลังจากนั้นออก (เช่น SEP_18 → SEP, ONHSI_P2 → ONHSI) — ในระบบยังเป็นรหัสเต็มเหมือนเดิม
function sheetCoverage(code: string): string {
  return code.replace(/_.*$/, '')
}

function patientName(p: Row['patients']): string {
  if (!p) return ''
  return Array.isArray(p) ? (p[0]?.full_name ?? '') : p.full_name
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'ใช้ได้เฉพาะ POST' }, 405)

  let caller: Awaited<ReturnType<typeof requireAdmin>> | null = null
  try {
    caller = await requireAdmin(req)
    const { admin, email } = caller

    // 1) ดึงทุกเคสจาก DB (แบ่งหน้าละ 1000) เรียงวันจำหน่ายใหม่สุดก่อน ที่ยังไม่มีวันจำหน่ายไว้ท้าย
    const byId = new Map<number, Row>()
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from('admissions')
        .select('admission_id,hn,an,encounter_id,coverage_code,payer_id,discharge_date,patients(full_name)')
        .gte('discharge_date', MIN_DISCHARGE_DATE) // ตัดเคสที่ยังไม่จำหน่าย (วันที่ว่าง) และเคสก่อนวันที่กำหนด
        .neq('coverage_code', 'UNK')
        .not('coverage_code', 'ilike', 'DIS%') // สิทธิส่วนลด/ส่วนเกิน (DIS_...) ไม่ต้องส่งให้ Audit
        .order('discharge_date', { ascending: false, nullsFirst: false })
        .order('admission_id', { ascending: false })
        .range(from, from + PAGE - 1)
      if (error) throw new HttpError(500, `อ่านข้อมูลเคสไม่สำเร็จ: ${error.message}`)
      const rows = (data ?? []) as unknown as Row[]
      for (const r of rows) byId.set(r.admission_id, r)
      if (rows.length < PAGE) break
    }
    const rows = [...byId.values()]
    const n = rows.length

    const values: unknown[][] = rows.map((r) => [
      r.hn,
      r.an,
      r.encounter_id,
      patientName(r.patients),
      sheetCoverage(r.coverage_code),
      /^\d+$/.test(r.payer_id) ? Number(r.payer_id) : r.payer_id, // payer เป็นเลข (เช่น 50257) ส่วน UNK เป็นข้อความ
      r.discharge_date ? isoToSerial(r.discharge_date) : '',
    ])

    // 2) เตรียมชีต: หาแท็บ + ตรวจหัวคอลัมน์ก่อนแตะข้อมูล
    const sa = loadServiceAccount()
    const sid = loadSheetId()
    const token = await getAccessToken(sa)
    const tab = findTab(await listTabs(token, sid), DATA_TAB)

    const head = (await getValues(token, sid, DATA_TAB, 'A1:G1'))[0] ?? []
    const headEmpty = head.every((c) => String(c ?? '').trim() === '')
    if (!headEmpty) {
      const got = HEADERS.map((_, i) => String(head[i] ?? '').trim())
      const bad = HEADERS.filter((h, i) => got[i].toLowerCase() !== h.toLowerCase())
      if (bad.length > 0) {
        throw new HttpError(
          422,
          `หัวคอลัมน์แถว 1 ของแท็บ "${DATA_TAB}" ไม่ตรงกับที่ระบบคาดไว้ (ต้องเป็น ${HEADERS.join(', ')} / พบ ${got.join(', ')}) — ยกเลิกการส่งเพื่อไม่ให้ข้อมูลเลื่อนผิดคอลัมน์`,
        )
      }
    }

    // 3) ขยายจำนวนแถวของแท็บให้พอ + ตั้งรูปแบบวันที่ dd/mm/yyyy ที่คอลัมน์ G
    const grid = Math.max(tab.rowCount, n + 1)
    const reqs: unknown[] = []
    if (grid > tab.rowCount) {
      reqs.push({
        updateSheetProperties: {
          properties: { sheetId: tab.sheetId, gridProperties: { rowCount: grid } },
          fields: 'gridProperties.rowCount',
        },
      })
    }
    reqs.push({
      repeatCell: {
        range: { sheetId: tab.sheetId, startRowIndex: 1, endRowIndex: grid, startColumnIndex: 6, endColumnIndex: 7 },
        cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    })
    await batchUpdate(token, sid, reqs)

    // 4) เขียนข้อมูลใหม่ทับก่อน แล้วค่อยล้างแถวที่เหลือด้านล่าง (ถ้าเขียนล้มเหลวกลางทาง ข้อมูลเดิมยังอยู่)
    if (head.length === 0 || headEmpty) await updateValues(token, sid, DATA_TAB, 'A1:G1', [HEADERS])
    if (n > 0) await updateValues(token, sid, DATA_TAB, `A2:G${n + 1}`, values)
    if (n + 2 <= grid) await clearValues(token, sid, DATA_TAB, `A${n + 2}:G${grid}`)

    const at = new Date().toISOString()
    await saveState(admin, {
      last_push_at: at,
      last_push_by: email,
      last_push_rows: n,
      last_push_ok: true,
      last_push_error: null,
    })
    return json({ ok: true, rows: n, at })
  } catch (e) {
    if (caller) {
      await saveState(caller.admin, {
        last_push_at: new Date().toISOString(),
        last_push_by: caller.email,
        last_push_ok: false,
        last_push_error: e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500),
      })
    }
    return errorResponse(e)
  }
})
