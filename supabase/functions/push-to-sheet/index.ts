// ส่งข้อมูลเคส (จำหน่ายตั้งแต่ 1 ต.ค. 2026 ไม่ใช่สิทธิ UNK และไม่ใช่สิทธิ DIS...) จากระบบ → แท็บ "ทะเบียนคุมเอกสารสิทธิ 70" ใน Google Sheet
// วิธีทำงาน: เทียบด้วยรหัสแถว (admission_id ในคอลัมน์ H ที่ซ่อนไว้) — เคสใหม่วางต่อท้าย, เคสเดิมที่ข้อมูลเปลี่ยนแก้แถวเดิม,
// เคสที่ไม่เข้าเงื่อนไขแล้วทำสีแดง (ไม่ลบ/ไม่ขยับแถว) — ไม่เรียงลำดับ ระบบเป็นต้นฉบับ ชีตเป็นสำเนา
// เรียกซ้ำกี่ครั้งผลก็เหมือนเดิม (idempotent) | mode 'rebuild' = ล้างแล้วเขียนใหม่ทั้งหมด (ใช้ซ่อม/ครั้งแรก)
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders, errorResponse, HttpError, json, requireAdmin, saveState } from './common.ts'
import { buildPlan, parseSheetRows, type Elig } from './plan.ts'
import {
  batchUpdate,
  batchUpdateValues,
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
const HELPER_HEADERS = ['admission_id', 'status'] // คอลัมน์ H, I (ซ่อน)
const RED = { red: 0.96, green: 0.8, blue: 0.8 }
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
    const reqBody = (await req.json().catch(() => ({}))) as { mode?: string }
    const forceRebuild = reqBody?.mode === 'rebuild'

    // 1) ดึงเคสที่เข้าเงื่อนไขจาก DB (แบ่งหน้าละ 1000) เรียงตามรหัสแถว
    const byId = new Map<number, Row>()
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from('admissions')
        .select('admission_id,hn,an,encounter_id,coverage_code,payer_id,discharge_date,patients(full_name)')
        .gte('discharge_date', MIN_DISCHARGE_DATE) // ตัดเคสที่ยังไม่จำหน่าย (วันที่ว่าง) และเคสก่อนวันที่กำหนด
        .neq('coverage_code', 'UNK')
        .not('coverage_code', 'ilike', 'DIS%') // สิทธิส่วนลด/ส่วนเกิน (DIS_...) ไม่ต้องส่งให้ Audit
        .order('admission_id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) throw new HttpError(500, `อ่านข้อมูลเคสไม่สำเร็จ: ${error.message}`)
      const rows = (data ?? []) as unknown as Row[]
      for (const r of rows) byId.set(r.admission_id, r)
      if (rows.length < PAGE) break
    }
    const elig: Elig[] = [...byId.values()].map((r) => ({
      key: r.admission_id,
      values: [
        r.hn,
        r.an,
        r.encounter_id,
        patientName(r.patients),
        sheetCoverage(r.coverage_code),
        /^\d+$/.test(r.payer_id) ? Number(r.payer_id) : r.payer_id, // payer เป็นเลข (เช่น 50257) ส่วน UNK เป็นข้อความ
        r.discharge_date ? isoToSerial(r.discharge_date) : '',
      ],
    }))
    const n = elig.length

    // 2) เตรียมชีต: หาแท็บ + ตรวจหัวคอลัมน์ก่อนแตะข้อมูล
    const sa = loadServiceAccount()
    const sid = loadSheetId()
    const token = await getAccessToken(sa)
    const tab = findTab(await listTabs(token, sid), DATA_TAB)

    const all = await getValues(token, sid, DATA_TAB, 'A1:I')
    const head = all[0] ?? []
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
    const helperMissing = headEmpty || String(head[7] ?? '').trim() === ''

    // 3) วางแผน (เทียบรหัสแถว)
    const plan = buildPlan(elig, parseSheetRows(all.slice(1)), forceRebuild)
    const lastNeeded = plan.rebuild ? n + 1 : plan.appendStart - 1 + plan.appends.length
    const grid = Math.max(tab.rowCount, lastNeeded, 2)

    // 4) จัดรูปแบบ: ขยายแถว/คอลัมน์ให้พอ, วันที่ dd/mm/yyyy ที่คอลัมน์ G, ซ่อน H–I, สีแดงสำหรับเคส void
    const sheetId = tab.sheetId
    const reqs: unknown[] = []
    if (grid > tab.rowCount) {
      reqs.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { rowCount: grid } }, fields: 'gridProperties.rowCount' } })
    }
    if (tab.columnCount < 9) {
      reqs.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { columnCount: 9 } }, fields: 'gridProperties.columnCount' } })
    }
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: grid, startColumnIndex: 6, endColumnIndex: 7 },
        cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    })
    if (helperMissing) {
      reqs.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: 7, endIndex: 9 },
          properties: { hiddenByUser: true },
          fields: 'hiddenByUser',
        },
      })
    }
    const rowRange = (row: number) => ({ sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 0, endColumnIndex: 7 })
    if (plan.rebuild) {
      reqs.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 1, endRowIndex: grid, startColumnIndex: 0, endColumnIndex: 7 },
          cell: { userEnteredFormat: {} },
          fields: 'userEnteredFormat.backgroundColor',
        },
      })
    }
    for (const r of plan.voids) {
      reqs.push({ repeatCell: { range: rowRange(r), cell: { userEnteredFormat: { backgroundColor: RED } }, fields: 'userEnteredFormat.backgroundColor' } })
    }
    for (const r of plan.restores) {
      reqs.push({ repeatCell: { range: rowRange(r), cell: { userEnteredFormat: {} }, fields: 'userEnteredFormat.backgroundColor' } })
    }
    await batchUpdate(token, sid, reqs)

    // 5) เขียนค่า — เขียนข้อมูลใหม่ก่อน ค่อยล้างส่วนที่เหลือ (ถ้าล้มเหลวกลางทาง ข้อมูลเดิมยังอยู่)
    const withHelper = (e: Elig) => [...e.values, e.key, 'active']
    if (plan.rebuild) {
      await updateValues(token, sid, DATA_TAB, 'A1:I1', [[...HEADERS, ...HELPER_HEADERS]])
      if (n > 0) await updateValues(token, sid, DATA_TAB, `A2:I${n + 1}`, plan.appends.map(withHelper))
      if (n + 2 <= grid) await clearValues(token, sid, DATA_TAB, `A${n + 2}:I${grid}`)
    } else {
      const data: { range: string; values: unknown[][] }[] = []
      if (helperMissing) data.push({ range: 'A1:I1', values: [[...HEADERS, ...HELPER_HEADERS]] })
      for (const u of plan.updates) data.push({ range: `A${u.row}:G${u.row}`, values: [u.values] })
      for (const r of plan.restores) data.push({ range: `I${r}`, values: [['active']] })
      for (const r of plan.voids) data.push({ range: `I${r}`, values: [['void']] })
      if (plan.appends.length > 0) {
        const end = plan.appendStart + plan.appends.length - 1
        data.push({ range: `A${plan.appendStart}:I${end}`, values: plan.appends.map(withHelper) })
      }
      await batchUpdateValues(token, sid, DATA_TAB, data)
    }

    const at = new Date().toISOString()
    const warnings: string[] = []
    if (plan.duplicateKeys.length > 0) {
      warnings.push(`พบรหัสแถวซ้ำในชีต ${plan.duplicateKeys.length} รหัส (อาจเกิดจากส่งพร้อมกัน) — ระบบไม่ลบให้ ตรวจในชีตหรือกด "สร้างชีตใหม่ทั้งหมด"`)
    }
    const result = {
      ok: true as const,
      rows: n,
      at,
      mode: plan.rebuild ? 'rebuild' : 'incremental',
      appended: plan.rebuild ? n : plan.appends.length,
      updated: plan.updates.length,
      voided: plan.voids.length,
      restored: plan.restores.length,
      warnings,
    }
    await saveState(admin, {
      last_push_at: at,
      last_push_by: email,
      last_push_rows: n,
      last_push_ok: true,
      last_push_error: null,
    })
    return json(result)
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
