import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fmtIsoDate, previewSheetAudit, type PullItem, type PullResult } from '../lib/sheetSync'

interface Props {
  onClose: () => void
  /** เรียกหลังบันทึกวัน Audit สำเร็จ */
  onDone: () => void
}

type Tab = 'ok' | 'recorded' | 'warn' | 'error' | 'ignored' | 'all'

const PAGE_SIZE = 100
const WRITE_CHUNK = 500

const TAB_LABEL: Record<Tab, string> = {
  ok: 'พร้อมนำเข้า (ยังไม่เคยบันทึก)',
  recorded: 'เคยบันทึกแล้ว',
  warn: 'มีข้อควรตรวจ',
  error: 'ผิดพลาด (คลิกนำเข้าทีละเคสได้)',
  ignored: 'ซ้ำในชีต (ตัดออก)',
  all: 'ทั้งหมด',
}

/** มีแถวสิทธิในระบบอย่างน้อย 1 แถวที่ยังไม่เคยบันทึกวัน Audit */
const hasNew = (i: PullItem) => i.targets.some((t) => t.state === 'new')
/** เคสที่ทุกแถวสิทธิเคยบันทึกวัน Audit ไว้แล้ว (ไม่ผิดพลาด ไม่ถูกตัดเพราะซ้ำ) */
const isRecorded = (i: PullItem) => !i.ignored && i.status !== 'error' && i.targets.length > 0 && !hasNew(i)

function inTab(i: PullItem, tab: Tab): boolean {
  if (tab === 'all') return true
  if (tab === 'ignored') return !!i.ignored
  if (i.ignored) return false
  if (tab === 'recorded') return isRecorded(i)
  if (tab === 'error') return i.status === 'error'
  return i.status === tab && !isRecorded(i) // ok / warn = ยังมีส่วนที่ยังไม่เคยบันทึก
}

// กลุ่มเรื่องที่ต้องตรวจ (แท็บ "มีข้อควรตรวจ") — 1 เคสอยู่ 1 กลุ่ม เรียงตามความร้ายแรง
type WarnGroup = 'cov_mismatch' | 'cov_not_master' | 'before_discharge' | 'other'
const WARN_GROUPS: WarnGroup[] = ['cov_mismatch', 'cov_not_master', 'before_discharge', 'other']
const GROUP_LABEL: Record<WarnGroup, string> = {
  cov_mismatch: 'สิทธิไม่ตรง',
  cov_not_master: 'สิทธิไม่อยู่ใน coverage_master',
  before_discharge: 'วัน Audit ก่อนวันจำหน่าย (ไม่ควรเกิด)',
  other: 'อื่น ๆ (HN/AN/ชื่อไม่ตรง, วันอนาคต, ซ้ำ ฯลฯ)',
}
const GROUP_HINT: Record<WarnGroup, string> = {
  cov_mismatch: 'ระบบมีสิทธิเดียวที่ encounter นี้ แต่ชีตลงสิทธิอื่น (ที่อยู่ใน coverage_master) — เจอบ่อย สุ่มตรวจแล้วติ๊กผ่านทั้งกลุ่มได้',
  cov_not_master: 'สิทธิในชีตไม่มีใน coverage_master (มักเป็นรหัสที่ audit พิมพ์เอง) — เจอบ่อย สุ่มตรวจแล้วติ๊กผ่านทั้งกลุ่มได้',
  before_discharge: 'วัน Audit เกิดก่อนวันจำหน่าย ซึ่งไม่ควรเป็นไปได้ — ตรวจและติ๊กเลือกทีละเคส',
  other: 'เรื่องอื่นที่ควรดูทีละเคส — ติ๊กเลือกทีละเคส',
}
/** กลุ่มที่ติ๊กผ่านทั้งกลุ่มได้ (เจอบ่อยและเสี่ยงต่ำ) */
const BULK_GROUPS: WarnGroup[] = ['cov_mismatch', 'cov_not_master']

function warnGroup(i: PullItem): WarnGroup {
  const f = i.flags
  if (!f || f.length === 0) return 'other' // ฟังก์ชันรุ่นเก่าไม่ส่ง flags → ให้ตรวจทีละเคสไว้ก่อน
  if (f.includes('before_discharge')) return 'before_discharge'
  if (f.includes('other')) return 'other'
  if (f.includes('cov_not_master')) return 'cov_not_master'
  return 'cov_mismatch'
}

/** แถวที่เลือกได้ = ยังไม่เคยบันทึก (ระบบไม่เขียนทับเคสที่เคยบันทึกวัน Audit แล้ว) */
const selectable = (i: PullItem) => !i.ignored && i.status !== 'error' && hasNew(i)

interface Cand {
  admission_id: number
  coverage_code: string
  payer_id: string
  discharge_date: string | null
  existing: string | null
}
/** รายการที่ผู้ใช้ยืนยันนำเข้าเองจากแท็บ "ผิดพลาด" (เฉพาะแถวสิทธิที่ยังไม่เคยบันทึก) */
interface Override {
  audit_date: string
  targets: { admission_id: number; coverage_code: string; payer_id: string }[]
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))
const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** หน้าต่างนำเข้าเคสที่ผิดพลาด: แสดงข้อผิดพลาดอีกครั้ง + แก้ได้เฉพาะวัน Audit / สิทธิ + ถามยืนยันถ้าไม่ได้แก้ */
function ErrorImportDialog({
  item,
  onCancel,
  onAccept,
}: {
  item: PullItem
  onCancel: () => void
  onAccept: (o: Override) => void
}) {
  const [cands, setCands] = useState<Cand[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [date, setDate] = useState(item.audit_date ?? '')
  const [cov, setCov] = useState('all')
  const [confirming, setConfirming] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (item.encounter_id === null) {
      setCands([])
      return
    }
    supabase
      .from('admissions')
      .select('admission_id,coverage_code,payer_id,discharge_date,case_tracking(audit_date)')
      .eq('encounter_id', item.encounter_id)
      .then(({ data, error }) => {
        if (error) {
          setLoadErr(error.message)
          return
        }
        type R = {
          admission_id: number
          coverage_code: string
          payer_id: string
          discharge_date: string | null
          case_tracking: { audit_date: string | null } | { audit_date: string | null }[] | null
        }
        setCands(
          ((data ?? []) as unknown as R[]).map((r) => ({
            admission_id: r.admission_id,
            coverage_code: r.coverage_code,
            payer_id: r.payer_id,
            discharge_date: r.discharge_date,
            existing: one(r.case_tracking)?.audit_date ?? null,
          })),
        )
      })
  }, [item.encounter_id])

  const covCodes = [...new Set((cands ?? []).map((c) => c.coverage_code))]
  const chosen = (cands ?? []).filter((c) => cov === 'all' || c.coverage_code === cov)
  const newTargets = chosen.filter((c) => c.existing === null)
  const skipped = chosen.filter((c) => c.existing !== null)
  const changed = date !== (item.audit_date ?? '') || cov !== 'all'

  const warns: string[] = []
  if (date && date > todayIso()) warns.push(`วัน Audit (${fmtIsoDate(date)}) อยู่ในอนาคต`)
  for (const c of newTargets) {
    if (date && c.discharge_date && date < c.discharge_date) {
      warns.push(`วัน Audit (${fmtIsoDate(date)}) ก่อนวันจำหน่าย (${fmtIsoDate(c.discharge_date)}) ของสิทธิ ${c.coverage_code}`)
      break
    }
  }

  function handleOk() {
    setMsg(null)
    if (!date) return setMsg('ต้องใส่วัน Audit ก่อนนำเข้า')
    if (newTargets.length === 0) return setMsg('สิทธิที่เลือกเคยบันทึกวัน Audit ไว้แล้วทั้งหมด — ไม่มีรายการให้นำเข้า (ระบบไม่เขียนทับ)')
    if (!changed && !confirming) {
      setConfirming(true) // ไม่ได้แก้อะไร → ถามยืนยันอีกครั้ง
      return
    }
    onAccept({
      audit_date: date,
      targets: newTargets.map((c) => ({ admission_id: c.admission_id, coverage_code: c.coverage_code, payer_id: c.payer_id })),
    })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/50 px-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface p-5 shadow-xl">
        <h3 className="mb-2 text-base font-semibold text-ink">นำเข้าเคสที่ผิดพลาด (แถวชีต {item.row})</h3>

        <div className="mb-3 rounded-lg border border-rose/30 bg-rose-soft/50 px-3 py-2 text-sm text-rose">
          <p className="mb-1 font-semibold">ข้อผิดพลาดของเคสนี้</p>
          {item.messages.map((m, k) => (
            <p key={k}>• {m}</p>
          ))}
        </div>

        <p className="mb-2 text-xs text-ink/60">
          encounter_id {item.encounter_id ?? '—'} · HN {item.hn || '—'} · {item.name || '—'} · สิทธิในชีต: {item.sithi || 'ว่าง'}
        </p>

        {!cands && !loadErr && <p className="py-4 text-center text-sm text-ink/60">กำลังอ่านข้อมูลเคสในระบบ…</p>}
        {loadErr && <p className="mb-3 text-sm text-rose">อ่านข้อมูลเคสไม่สำเร็จ: {loadErr}</p>}

        {cands && cands.length === 0 && (
          <p className="mb-3 text-sm text-rose">ไม่พบ encounter_id นี้ในระบบ จึงไม่มีเคสให้ลงวัน Audit — นำเข้าไม่ได้ (ต้องแก้ที่ชีตหรือนำเข้าเคสนี้จาก HIS ก่อน)</p>
        )}

        {cands && cands.length > 0 && (
          <>
            <div className="mb-3 rounded-lg bg-paper px-3 py-2 text-xs text-ink/70">
              <p className="mb-1 font-medium text-ink">สิทธิของเคสนี้ในระบบ</p>
              {cands.map((c) => (
                <p key={c.admission_id}>
                  {c.coverage_code} / ผู้จ่าย {c.payer_id}
                  {c.discharge_date && <> · จำหน่าย {fmtIsoDate(c.discharge_date)}</>} ·{' '}
                  {c.existing ? <span className="text-alert">เคยบันทึกแล้ว {fmtIsoDate(c.existing)}</span> : 'ยังไม่เคยบันทึก'}
                </p>
              ))}
            </div>

            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-ink">
                <span className="mb-1 block text-xs text-ink/60">วัน Audit</span>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value)
                    setConfirming(false)
                  }}
                  className="input w-full"
                />
              </label>
              <label className="text-sm text-ink">
                <span className="mb-1 block text-xs text-ink/60">ลงวัน Audit ให้สิทธิ</span>
                <select
                  value={cov}
                  onChange={(e) => {
                    setCov(e.target.value)
                    setConfirming(false)
                  }}
                  className="input w-full"
                >
                  <option value="all">ทุกสิทธิของเคสนี้ (ตามปกติ)</option>
                  {covCodes.map((c) => (
                    <option key={c} value={c}>
                      เฉพาะ {c}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <p className="mb-2 text-xs text-ink/60">
              จะบันทึก {newTargets.length} แถวสิทธิ
              {skipped.length > 0 && ` (ข้าม ${skipped.length} แถวที่เคยบันทึกแล้ว — ไม่เขียนทับ)`} · แก้ได้เฉพาะวัน Audit และสิทธิที่จะลง
            </p>

            {warns.length > 0 && (
              <div className="mb-2 rounded-lg border border-alert/40 bg-paper px-3 py-2 text-xs text-alert">
                {warns.map((w, k) => (
                  <p key={k}>⚠ {w}</p>
                ))}
              </div>
            )}
          </>
        )}

        {msg && <p className="mb-2 text-sm text-rose">{msg}</p>}

        {confirming ? (
          <div className="rounded-lg border border-ink/30 bg-brand-soft px-3 py-3">
            <p className="mb-2 text-sm font-medium text-ink">
              คุณยังไม่ได้แก้ไขข้อมูล ยืนยันนำเข้าตามที่แมพปกติหรือไม่? (วัน Audit {fmtIsoDate(date)} → {newTargets.map((c) => c.coverage_code).join(', ')})
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirming(false)} className="rounded-lg border border-ink/40 px-4 py-1.5 text-sm text-ink hover:bg-brand-soft">
                กลับไปแก้
              </button>
              <button onClick={handleOk} className="rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-ink hover:bg-brand-dark">
                ยืนยันนำเข้า
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <button onClick={onCancel} className="rounded-lg border border-ink/40 px-4 py-2 text-sm text-ink hover:bg-brand-soft">
              ยกเลิก
            </button>
            <button
              onClick={handleOk}
              disabled={!cands || cands.length === 0}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-ink hover:bg-brand-dark disabled:opacity-50"
            >
              ตกลง
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function SheetAuditPull({ onClose, onDone }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<PullResult | null>(null)
  const [tab, setTab] = useState<Tab>('ok')
  const [grp, setGrp] = useState<WarnGroup>('cov_mismatch')
  const [page, setPage] = useState(1)
  const [included, setIncluded] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // เคสผิดพลาดที่ผู้ใช้ยืนยันนำเข้าเอง (key = แถวชีต)
  const [overrides, setOverrides] = useState<Map<number, Override>>(new Map())
  const [editing, setEditing] = useState<PullItem | null>(null)

  function load() {
    setLoading(true)
    setError(null)
    setResult(null)
    setSaved(false)
    setOverrides(new Map())
    previewSheetAudit()
      .then((res) => {
        setData(res)
        // ค่าเริ่มต้น: เลือกเฉพาะแถวที่ไม่มีข้อควรตรวจ — แถวที่มีคำเตือนต้องให้คนตัดสินใจเอง
        setIncluded(new Set(res.items.filter((i) => selectable(i) && i.status === 'ok').map((i) => i.row)))
        const cnt = (t: Tab) => res.items.filter((i) => inTab(i, t)).length
        setTab(cnt('ok') > 0 ? 'ok' : cnt('recorded') > 0 ? 'recorded' : cnt('warn') > 0 ? 'warn' : 'error')
        setPage(1)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const items = data?.items ?? []
  const shown = useMemo(
    () => items.filter((i) => inTab(i, tab) && (tab !== 'warn' || warnGroup(i) === grp)),
    [items, tab, grp],
  )
  const groupCount = (g: WarnGroup) => items.filter((i) => inTab(i, 'warn') && warnGroup(i) === g).length
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const curPage = Math.min(page, pageCount)
  const pageRows = shown.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE)

  const tabCount = (t: Tab) => items.filter((i) => inTab(i, t)).length

  // จำนวนแถวสิทธิที่จะบันทึกจริง = เฉพาะแถวสิทธิที่ยังไม่เคยบันทึก ของแถวที่ติ๊กเลือกไว้
  const writeCount = useMemo(() => {
    let n = 0
    for (const i of items) {
      if (!included.has(i.row) || !selectable(i)) continue
      n += i.targets.filter((t) => t.state === 'new').length
    }
    for (const o of overrides.values()) n += o.targets.length
    return n
  }, [items, included, overrides])
  const recordedCount = items.filter(isRecorded).length

  function toggle(row: number) {
    setIncluded((prev) => {
      const next = new Set(prev)
      if (next.has(row)) next.delete(row)
      else next.add(row)
      return next
    })
  }

  // เลือก/ยกเลิกทั้งหมดของแท็บที่เปิดอยู่ (เฉพาะแถวที่เลือกได้)
  function toggleTab() {
    const rows = shown.filter(selectable).map((i) => i.row)
    const allOn = rows.length > 0 && rows.every((r) => included.has(r))
    setIncluded((prev) => {
      const next = new Set(prev)
      for (const r of rows) {
        if (allOn) next.delete(r)
        else next.add(r)
      }
      return next
    })
  }

  async function handleConfirm() {
    if (writeCount === 0 || saving) return
    setSaving(true)
    setResult(null)
    // key = admission_id (1 แถวชีตอาจลงได้หลายสิทธิ/ผู้จ่ายของ encounter เดียวกัน) — ส่งเฉพาะ audit_date ไม่แตะฟิลด์อื่น
    const payload = new Map<number, { admission_id: number; encounter_id: number; audit_date: string }>()
    for (const i of items) {
      if (!included.has(i.row) || !selectable(i) || i.encounter_id === null || !i.audit_date) continue
      for (const t of i.targets.filter((x) => x.state === 'new')) {
        payload.set(t.admission_id, { admission_id: t.admission_id, encounter_id: i.encounter_id, audit_date: i.audit_date })
      }
    }
    for (const [row, o] of overrides) {
      const it = items.find((x) => x.row === row)
      if (!it || it.encounter_id === null) continue
      for (const t of o.targets) payload.set(t.admission_id, { admission_id: t.admission_id, encounter_id: it.encounter_id, audit_date: o.audit_date })
    }
    const rows = [...payload.values()]
    let done = 0
    try {
      for (let k = 0; k < rows.length; k += WRITE_CHUNK) {
        const chunk = rows.slice(k, k + WRITE_CHUNK)
        const { error: e } = await supabase.from('case_tracking').upsert(chunk, { onConflict: 'admission_id' })
        if (e) throw e
        done += chunk.length
      }
      // บันทึกเวลาดึงล่าสุด (ถ้ายังไม่ได้สร้างฟังก์ชันนี้ใน DB ก็ไม่ถือเป็นความผิดพลาด)
      await supabase.rpc('mark_sheet_pull', { p_rows: done })
      setResult(
        `บันทึกวัน Audit สำเร็จ ${done.toLocaleString()} รายการ (แถวสิทธิ)` +
          (recordedCount > 0 ? ` · เคสที่เคยบันทึกแล้ว ${recordedCount.toLocaleString()} ไม่ถูกแตะ` : ''),
      )
      setSaved(true)
      onDone()
    } catch (e) {
      const msg = e instanceof Error ? e.message : (e as { message?: string })?.message
      setResult(
        `บันทึกไม่สำเร็จ: ${msg ?? e}` + (done > 0 ? ` (บันทึกไปแล้ว ${done.toLocaleString()} รายการก่อนหน้านี้ — โหลดใหม่เพื่อดูสถานะล่าสุด)` : ''),
      )
    } finally {
      setSaving(false)
    }
  }

  const tabRows = shown.filter(selectable)
  const allTabOn = tabRows.length > 0 && tabRows.every((i) => included.has(i.row))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-y-auto rounded-2xl bg-surface p-6 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">ดึงวัน Audit จาก Google Sheet</h2>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-lg leading-none text-ink hover:bg-brand">
            ✕
          </button>
        </div>

        {loading && <p className="py-10 text-center text-sm text-ink/60">กำลังอ่านชีตและตรวจข้อมูล… (อาจใช้เวลาสักครู่)</p>}

        {!loading && error && (
          <div className="mb-3 rounded-lg border border-rose/30 bg-rose-soft/50 px-4 py-3 text-sm text-rose">
            <p className="mb-2">{error}</p>
            <button onClick={load} className="rounded-lg border border-rose/40 px-3 py-1 text-sm hover:bg-rose-soft">
              ลองใหม่
            </button>
          </div>
        )}

        {!loading && data && (
          <>
            <p className="mb-2 text-sm text-ink/70">
              อ่านจากแท็บ AUDIT_VIEW {data.summary.total.toLocaleString()} แถว · ยังไม่เคยบันทึก {tabCount('ok').toLocaleString()} · เคยบันทึกแล้ว{' '}
              {tabCount('recorded').toLocaleString()} · มีข้อควรตรวจ {tabCount('warn').toLocaleString()} · ผิดพลาด {data.summary.error.toLocaleString()}
              {data.summary.ignored > 0 && <> · ซ้ำในชีต {data.summary.ignored.toLocaleString()}</>}
            </p>
            <p className="mb-3 text-xs text-ink/50">
              เคสในแท็บ “ผิดพลาด” ไม่ถูกนำเข้าอัตโนมัติ — กด “นำเข้าเคสนี้…” เพื่อตรวจและยืนยันทีละเคส (แก้ได้เฉพาะวัน Audit และสิทธิที่จะลง) ·
              นำเข้าเฉพาะเคสที่ยังไม่เคยบันทึกวัน Audit — แถวที่พร้อมนำเข้าถูกเลือกไว้ให้แล้ว ส่วนแถวที่มีข้อควรตรวจ (เช่น สิทธิ/HN/ชื่อไม่ตรง) ต้องติ๊กเองหลังตรวจดู
              เคสที่เคยบันทึกแล้วอยู่ในแท็บ “เคยบันทึกแล้ว” ระบบไม่เขียนทับ — การจับคู่ใช้ encounter_id + สิทธิ
            </p>

            <div className="mb-3 flex flex-wrap items-center gap-2">
              {(['ok', 'recorded', 'warn', 'error', 'ignored', 'all'] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setTab(t)
                    if (t === 'warn') setGrp(WARN_GROUPS.find((g) => groupCount(g) > 0) ?? 'cov_mismatch')
                    setPage(1)
                  }}
                  className={
                    'rounded-lg border px-3 py-1.5 text-sm transition-colors ' +
                    (tab === t ? 'border-ink bg-brand font-semibold text-ink' : 'border-ink/30 text-ink hover:bg-brand-soft')
                  }
                >
                  {TAB_LABEL[t]} ({tabCount(t).toLocaleString()})
                </button>
              ))}
              {tab !== 'warn' && tabRows.length > 0 && (
                <button onClick={toggleTab} className="ml-auto rounded-lg border border-ink/30 px-3 py-1.5 text-sm text-ink hover:bg-brand-soft">
                  {allTabOn ? 'ยกเลิกเลือกทั้งแท็บนี้' : `เลือกทั้งแท็บนี้ (${tabRows.length.toLocaleString()})`}
                </button>
              )}
            </div>

            {tab === 'warn' && (
              <div className="mb-3 rounded-lg border border-line bg-paper px-3 py-2">
                <div className="mb-2 flex flex-wrap gap-2">
                  {WARN_GROUPS.map((g) => (
                    <button
                      key={g}
                      onClick={() => {
                        setGrp(g)
                        setPage(1)
                      }}
                      className={
                        'rounded-lg border px-3 py-1 text-sm transition-colors ' +
                        (grp === g ? 'border-ink bg-brand font-semibold text-ink' : 'border-ink/30 text-ink hover:bg-brand-soft')
                      }
                    >
                      {GROUP_LABEL[g]} ({groupCount(g).toLocaleString()})
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink/60">
                  <span>{GROUP_HINT[grp]}</span>
                  {BULK_GROUPS.includes(grp) && tabRows.length > 0 && (
                    <button onClick={toggleTab} className="ml-auto rounded-lg border border-ink/40 px-3 py-1 text-sm font-medium text-ink hover:bg-brand-soft">
                      {allTabOn ? 'ยกเลิกติ๊กทั้งกลุ่ม' : `ติ๊กผ่านทั้งกลุ่ม (${tabRows.length.toLocaleString()})`}
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="mb-3 max-h-[46vh] overflow-auto rounded-lg border border-line text-xs">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-paper text-ink/50">
                  <tr>
                    <th className="px-2 py-1.5"></th>
                    <th className="px-2 py-1.5">แถวชีต</th>
                    <th className="px-2 py-1.5">encounter_id</th>
                    <th className="px-2 py-1.5">HN</th>
                    <th className="px-2 py-1.5">ชื่อ</th>
                    <th className="px-2 py-1.5">สิทธิ</th>
                    <th className="px-2 py-1.5">วัน Audit</th>
                    <th className="px-2 py-1.5">ในระบบ</th>
                    <th className="px-2 py-1.5">ผลตรวจ</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-2 py-6 text-center text-ink/50">
                        ไม่มีรายการในแท็บนี้
                      </td>
                    </tr>
                  )}
                  {pageRows.map((i) => {
                    const can = selectable(i)
                    return (
                      <tr key={i.row} className={`border-t border-line align-top ${i.ignored ? 'opacity-60' : ''}`}>
                        <td className="px-2 py-1.5">
                          {can && <input type="checkbox" checked={included.has(i.row)} onChange={() => toggle(i.row)} />}
                        </td>
                        <td className="px-2 py-1.5 text-ink/60">{i.row}</td>
                        <td className="px-2 py-1.5">{i.encounter_id ?? '—'}</td>
                        <td className="px-2 py-1.5">{i.hn || '—'}</td>
                        <td className="px-2 py-1.5">{i.name || '—'}</td>
                        <td className="px-2 py-1.5">{i.sithi || '—'}</td>
                        <td className="px-2 py-1.5">{fmtIsoDate(i.audit_date)}</td>
                        <td className="px-2 py-1.5">
                          {i.targets.length === 0
                            ? '—'
                            : i.targets.map((t) => (
                                <span key={t.admission_id} className="block">
                                  {i.targets.length > 1 && <span className="text-ink/50">{t.coverage_code}/{t.payer_id}: </span>}
                                  {t.state === 'new' ? (
                                    <span>ยังไม่เคยบันทึก</span>
                                  ) : t.state === 'same' ? (
                                    <span className="text-ink/50">เคยบันทึกแล้ว {fmtIsoDate(t.existing)} (ตรงกับชีต)</span>
                                  ) : (
                                    <span className="text-alert">
                                      เคยบันทึกแล้ว {fmtIsoDate(t.existing)} · <span className="font-semibold">ชีตเป็น {fmtIsoDate(i.audit_date)}</span>
                                    </span>
                                  )}
                                </span>
                              ))}
                        </td>
                        <td className="px-2 py-1.5">
                          {i.ignored ? (
                            <span className="text-ink/60">{i.ignored}</span>
                          ) : i.status === 'error' ? (
                            <span>
                              <span className="block text-rose">{i.messages.join(' · ')}</span>
                              {overrides.has(i.row) ? (
                                <span className="mt-1 flex flex-wrap items-center gap-2">
                                  <span className="font-semibold text-ink">
                                    ✓ รอนำเข้า: {fmtIsoDate(overrides.get(i.row)!.audit_date)} → {overrides.get(i.row)!.targets.map((t) => t.coverage_code).join(', ')}
                                  </span>
                                  <button onClick={() => setEditing(i)} disabled={saved} className="rounded border border-ink/30 px-2 py-0.5 hover:bg-brand-soft disabled:opacity-40">
                                    แก้ไข
                                  </button>
                                  <button
                                    onClick={() =>
                                      setOverrides((prev) => {
                                        const next = new Map(prev)
                                        next.delete(i.row)
                                        return next
                                      })
                                    }
                                    disabled={saved}
                                    className="rounded border border-ink/30 px-2 py-0.5 hover:bg-brand-soft disabled:opacity-40"
                                  >
                                    ยกเลิก
                                  </button>
                                </span>
                              ) : (
                                i.encounter_id !== null && (
                                  <button onClick={() => setEditing(i)} disabled={saved} className="mt-1 rounded border border-ink/40 px-2 py-0.5 font-medium text-ink hover:bg-brand-soft disabled:opacity-40">
                                    นำเข้าเคสนี้…
                                  </button>
                                )
                              )}
                            </span>
                          ) : i.status === 'warn' ? (
                            <span className="text-alert">{i.messages.join(' · ')}</span>
                          ) : (
                            <span className="font-semibold text-ink">ผ่าน</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {shown.length > PAGE_SIZE && (
              <div className="mb-3 flex items-center justify-between text-sm text-ink/60">
                <span>
                  หน้า {curPage} / {pageCount}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(curPage - 1)}
                    disabled={curPage <= 1}
                    className="rounded-lg border border-line px-3 py-1 hover:bg-paper disabled:opacity-40"
                  >
                    ก่อนหน้า
                  </button>
                  <button
                    onClick={() => setPage(curPage + 1)}
                    disabled={curPage >= pageCount}
                    className="rounded-lg border border-line px-3 py-1 hover:bg-paper disabled:opacity-40"
                  >
                    ถัดไป
                  </button>
                </div>
              </div>
            )}

            <p className="mb-3 text-sm text-ink/70">
              ที่เลือกไว้จะบันทึก {writeCount.toLocaleString()} แถวสิทธิ (เฉพาะที่ยังไม่เคยบันทึกวัน Audit)
              {tab === 'recorded' && ' — แท็บนี้แสดงไว้ให้ดูเท่านั้น ไม่มีการนำเข้า ถ้าวันในชีตต่างจากที่บันทึกไว้จะแสดงเป็นสีแดง'}
            </p>
          </>
        )}

        {result && <p className="mb-3 text-sm text-ink">{result}</p>}

        {editing && (
          <ErrorImportDialog
            key={editing.row}
            item={editing}
            onCancel={() => setEditing(null)}
            onAccept={(o) => {
              setOverrides((prev) => new Map(prev).set(editing.row, o))
              setEditing(null)
            }}
          />
        )}

        <div className="flex justify-end gap-2">
          {data && !loading && (
            <button onClick={load} disabled={saving} className="rounded-lg border border-ink/30 px-4 py-2 text-sm text-ink hover:bg-brand-soft disabled:opacity-40">
              อ่านชีตใหม่
            </button>
          )}
          <button onClick={onClose} className="rounded-lg border border-ink/40 px-4 py-2 text-sm font-medium text-ink hover:bg-brand-soft">
            ปิด
          </button>
          <button
            onClick={handleConfirm}
            disabled={writeCount === 0 || saving || loading || saved || !!error}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-ink hover:bg-brand-dark disabled:opacity-50"
          >
            {saving ? 'กำลังบันทึก…' : saved ? 'บันทึกแล้ว' : `บันทึก ${writeCount.toLocaleString()} เคส`}
          </button>
        </div>
      </div>
    </div>
  )
}
