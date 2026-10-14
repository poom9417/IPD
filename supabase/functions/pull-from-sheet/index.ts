// อ่านผล Audit จากแท็บ AUDIT_VIEW (IMPORTRANGE จากชีตของทีม Audit) แล้วตรวจเบื้องต้นเทียบกับฐานข้อมูล
// ฟังก์ชันนี้ "ไม่เขียนอะไรลงฐานข้อมูล" — คืนผลตรวจให้หน้าเว็บแสดง Preview แล้วผู้ใช้กดยืนยันเอง
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders, errorResponse, HttpError, json, requireAdmin } from './common.ts'
import { findTab, getAccessToken, getValues, listTabs, loadServiceAccount, loadSheetId, serialToIso } from './google.ts'

const VIEW_TAB = 'AUDIT_VIEW'
const CHUNK = 400

type State = 'new' | 'same' | 'conflict'
interface Target {
  admission_id: number
  coverage_code: string
  payer_id: string
  existing: string | null
  state: State
}
interface Item {
  row: number
  hn: string
  an: number | null
  encounter_id: number | null
  name: string
  sithi: string
  audit_date: string | null
  status: 'ok' | 'warn' | 'error'
  messages: string[]
  /** รหัสเรื่องที่ต้องตรวจ: cov_mismatch | cov_not_master | before_discharge | other */
  flags: string[]
  targets: Target[]
  /** แถวที่ถูกตัดออกเพราะซ้ำกับแถวอื่นในชีต (ไม่นำเข้า) */
  ignored?: string
}

type Adm = {
  admission_id: number
  encounter_id: number
  an: number
  hn: string
  coverage_code: string
  payer_id: string
  admit_date: string
  discharge_date: string | null
  patients: { full_name: string } | { full_name: string }[] | null
  case_tracking: { audit_date: string | null } | { audit_date: string | null }[] | null
}

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)
const str = (v: unknown) => (v == null ? '' : String(v).trim())
const normName = (s: string) => s.replace(/[\s.]+/g, '')
// HN ในแต่ละระบบอาจเติมศูนย์หน้าเลขต่างกัน (C01275931 กับ C1275931) → เทียบแบบตัดศูนย์นำหน้า
const normHn = (s: string) => {
  const m = /^([A-Za-z]*)0*(\d+)$/.exec(s.trim())
  return m ? m[1].toUpperCase() + m[2] : s.trim().toUpperCase()
}
const toInt = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? v : null
  const s = str(v)
  return /^\d+$/.test(s) && Number(s) > 0 ? Number(s) : null
}
const fmtThai = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

function parseDate(v: unknown): { iso: string | null; err?: string } {
  if (v === '' || v == null) return { iso: null, err: 'ไม่มีวัน Audit' }
  let iso: string
  if (typeof v === 'number') {
    if (v < 1) return { iso: null, err: `วัน Audit ไม่ถูกต้อง (ค่า ${v} = 30/12/1899)` }
    iso = serialToIso(v)
  } else {
    const s = str(v)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return { iso: null, err: `วัน Audit เป็นข้อความ "${s}" — ตั้งรูปแบบคอลัมน์ Date Audit ในชีตเป็น "วันที่" เพื่อไม่ให้สลับวัน/เดือน` }
    }
    iso = s
  }
  const y = Number(iso.slice(0, 4))
  if (y < 2000 || y > 2100) return { iso: null, err: `วัน Audit ผิดปกติ (${fmtThai(iso)})` }
  return { iso }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'ใช้ได้เฉพาะ POST' }, 405)

  try {
    const { admin } = await requireAdmin(req)

    // 1) อ่านแท็บ AUDIT_VIEW (ค่าดิบ วันที่เป็น serial)
    const sa = loadServiceAccount()
    const sid = loadSheetId()
    const token = await getAccessToken(sa)
    findTab(await listTabs(token, sid), VIEW_TAB)
    const all = await getValues(token, sid, VIEW_TAB, 'A:G')
    if (all.length === 0) throw new HttpError(422, `แท็บ ${VIEW_TAB} ว่างเปล่า — ตรวจสูตร IMPORTRANGE ว่ายังทำงานอยู่`)

    const h = (i: number) => str(all[0][i]).toLowerCase()
    const headOk =
      h(0) === 'hn' && h(1) === 'an' && h(2).includes('encounter') && h(3) === 'name' && h(4) === 'sithi' && h(5).includes('date audit')
    if (!headOk) {
      const a1 = str(all[0][0])
      const hint = a1.startsWith('#') || /loading/i.test(a1) ? ' (ดูเหมือนสูตร IMPORTRANGE ยังไม่ได้รับอนุญาตหรือยังโหลดไม่เสร็จ)' : ''
      throw new HttpError(
        422,
        `หัวคอลัมน์ของแท็บ ${VIEW_TAB} ไม่ตรงกับที่คาดไว้ (HN, AN, Encounter_id ref., NAME, Sithi, Date Audit) — พบ: ${[0, 1, 2, 3, 4, 5].map((i) => str(all[0][i])).join(', ')}${hint}`,
      )
    }

    // 2) แปลงแถว
    const items: Item[] = []
    for (let i = 1; i < all.length; i++) {
      const r = all[i]
      if (!r || r.slice(0, 6).every((c) => str(c) === '')) continue
      const enc = toInt(r[2])
      const d = parseDate(r[5])
      items.push({
        row: i + 1,
        hn: str(r[0]),
        an: toInt(r[1]),
        encounter_id: enc,
        name: str(r[3]),
        sithi: str(r[4]),
        audit_date: d.iso,
        status: 'ok',
        messages: [],
        flags: [],
        targets: [],
        ...(enc === null ? { _e: 'เลข encounter_id ไม่ถูกต้อง' } : {}),
        ...(d.err ? { _d: d.err } : {}),
      } as Item)
    }

    // 3) ดึงเคสในระบบที่ตรงกับ encounter_id ในชีต
    const encIds = [...new Set(items.map((x) => x.encounter_id).filter((x): x is number => x !== null))]
    const byEnc = new Map<number, Adm[]>()
    for (let i = 0; i < encIds.length; i += CHUNK) {
      const { data, error } = await admin
        .from('admissions')
        .select('admission_id,encounter_id,an,hn,coverage_code,payer_id,admit_date,discharge_date,patients(full_name),case_tracking(audit_date)')
        .in('encounter_id', encIds.slice(i, i + CHUNK))
      if (error) throw new HttpError(500, `อ่านข้อมูลเคสไม่สำเร็จ: ${error.message}`)
      for (const a of (data ?? []) as unknown as Adm[]) {
        const list = byEnc.get(a.encounter_id) ?? []
        list.push(a)
        byEnc.set(a.encounter_id, list)
      }
    }
    const { data: cov } = await admin.from('coverage_master').select('coverage_code')
    const covSet = new Set((cov ?? []).map((c: { coverage_code: string }) => c.coverage_code.toLowerCase()))
    const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10) // วันนี้ตามเวลาไทย

    // 4) ตรวจทีละแถว
    for (const it of items) {
      const raw = it as Item & { _e?: string; _d?: string }
      const errs: string[] = []
      if (raw._e) errs.push(raw._e)
      if (raw._d) errs.push(raw._d)
      delete raw._e
      delete raw._d

      const cands = it.encounter_id !== null ? (byEnc.get(it.encounter_id) ?? []) : []
      if (it.encounter_id !== null && cands.length === 0) errs.push('ไม่พบ encounter_id นี้ในระบบ')

      let matched: Adm[] = []
      const warns: string[] = []
      const flags: string[] = []
      if (cands.length > 0) {
        const exact = cands.filter((a) => a.coverage_code.toLowerCase() === it.sithi.toLowerCase())
        if (exact.length > 0) {
          matched = exact
        } else if (cands.length === 1) {
          matched = cands
          const notMaster = !it.sithi || !covSet.has(it.sithi.toLowerCase())
          warns.push(
            `สิทธิไม่ตรง (ระบบ: ${cands[0].coverage_code} / Audit: ${it.sithi || 'ว่าง'})` +
              (notMaster ? ' และสิทธินี้ไม่อยู่ใน coverage_master' : ''),
          )
          flags.push(notMaster ? 'cov_not_master' : 'cov_mismatch')
        } else {
          errs.push(`encounter นี้แยกหลายสิทธิ แต่สิทธิในชีต (${it.sithi || 'ว่าง'}) ไม่ตรงกับแถวไหนเลย (ระบบ: ${cands.map((a) => a.coverage_code).join(', ')})`)
        }
      }

      if (errs.length > 0) {
        it.status = 'error'
        it.messages = errs
        continue
      }

      if (matched.length > 1) warns.push(`พบ ${matched.length} แถวในระบบที่สิทธิเดียวกัน (คนละผู้จ่าย) — จะลงวัน Audit ให้ทุกแถว`), flags.push('other')
      const a0 = matched[0]
      const p = one(a0.patients)
      if (it.hn && normHn(it.hn) !== normHn(a0.hn)) { warns.push(`HN ไม่ตรง (ระบบ: ${a0.hn} / ชีต: ${it.hn})`); flags.push('other') }
      if (it.an !== null && it.an !== a0.an) { warns.push(`AN ไม่ตรง (ระบบ: ${a0.an} / ชีต: ${it.an})`); flags.push('other') }
      if (it.name && p?.full_name && normName(it.name) !== normName(p.full_name)) {
        warns.push(`ชื่อไม่ตรง (ระบบ: ${p.full_name} / ชีต: ${it.name})`)
        flags.push('other')
      }
      const aud = it.audit_date as string
      if (aud > today) { warns.push(`วัน Audit อยู่ในอนาคต (${fmtThai(aud)})`); flags.push('other') }
      if (a0.discharge_date && aud < a0.discharge_date) {
        warns.push(`วัน Audit (${fmtThai(aud)}) ก่อนวันจำหน่าย (${fmtThai(a0.discharge_date)})`)
        flags.push('before_discharge')
      }

      it.targets = matched.map((a) => {
        const old = one(a.case_tracking)?.audit_date ?? null
        return {
          admission_id: a.admission_id,
          coverage_code: a.coverage_code,
          payer_id: a.payer_id,
          existing: old,
          state: old === null ? 'new' : old === aud ? 'same' : 'conflict',
        } as Target
      })
      it.messages = warns
      it.flags = flags
      it.status = warns.length > 0 ? 'warn' : 'ok'
    }

    // 5) แถวซ้ำในชีต (encounter + สิทธิ เดียวกัน): ใช้แถวที่มีวัน Audit ล่าสุด ที่เหลือตัดออกและบอกไว้
    const groups = new Map<string, Item[]>()
    for (const it of items) {
      if (it.status === 'error' || it.encounter_id === null) continue
      const k = `${it.encounter_id}|${it.sithi.toLowerCase()}`
      const g = groups.get(k) ?? []
      g.push(it)
      groups.set(k, g)
    }
    for (const g of groups.values()) {
      if (g.length < 2) continue
      const primary = g.reduce((best, x) => ((x.audit_date as string) > (best.audit_date as string) ? x : best), g[0])
      const dates = [...new Set(g.map((x) => x.audit_date as string))]
      if (dates.length > 1) {
        primary.messages.push(`ซ้ำ ${g.length} แถวในชีต วัน Audit ต่างกัน (${dates.map(fmtThai).join(', ')}) — ใช้วันล่าสุด`)
        primary.flags.push('other')
        if (primary.status === 'ok') primary.status = 'warn'
      }
      for (const x of g) if (x !== primary) x.ignored = `ซ้ำกับแถว ${primary.row} ในชีต`
    }

    const live = items.filter((x) => !x.ignored)
    const summary = {
      total: items.length,
      ok: live.filter((x) => x.status === 'ok').length,
      warn: live.filter((x) => x.status === 'warn').length,
      error: live.filter((x) => x.status === 'error').length,
      ignored: items.length - live.length,
    }
    return json({ ok: true, summary, items })
  } catch (e) {
    return errorResponse(e)
  }
})
