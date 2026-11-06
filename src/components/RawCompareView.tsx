import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useSheetPush } from '../lib/sheetSync'
import Button from './ui/Button'

/**
 * เทียบ "ข้อมูลในระบบปกติ" (admissions) กับ "ข้อมูลดิบที่อัปโหลด" (admissions_raw)
 * - ไม่แก้ข้อมูลดิบ และไม่เกี่ยวกับการส่ง Google Sheet
 * - ยกเว้นปุ่ม "เพิ่มเคสจากดิบ" (เฉพาะสถานะถูกลบจากระบบ) ที่สร้างแถวใน admissions จากดิบ — อ่านดิบอย่างเดียว
 *   ฝั่งฐานข้อมูลบันทึกผู้เพิ่ม/เวลา/แถวดิบต้นทางไว้ใน admissions_restore_log และส่งไป Google Sheet ต่อทันทีเหมือนการลบ/นำเข้า
 * - เห็นได้เฉพาะ admin/developer (ฐานข้อมูลบังคับสิทธิ์อ่าน admissions_raw ซ้ำอีกชั้น)
 */

const S_SAME = 'ตรงกับดิบ'
const S_DIFF = 'สิทธิ/ผู้จ่ายต่างจากดิบ'
const S_NORAW = 'ไม่มีในข้อมูลดิบ (เพิ่มเอง/ไม่ทราบที่มา)'
const S_DELETED = 'อยู่ในดิบ แต่ถูกลบจากระบบ'
const S_NEW = 'เพิ่มใหม่จากดิบ'

/** เวลาที่โชว์เคสที่เพิ่งเพิ่มจากดิบ ก่อนหุบกลับเอง (มิลลิวินาที) */
const FLASH_MS = 8000

const FILTERS: { key: string; label: string }[] = [
  { key: 'alert', label: 'ที่ต้องตรวจ: ต่างจากดิบ + ถูกลบ + เพิ่มใหม่' },
  { key: 'diff_all', label: 'ทุกรายการที่ต่างจากดิบ' },
  { key: S_DIFF, label: 'สิทธิ/ผู้จ่ายต่างจากดิบ' },
  { key: S_NORAW, label: 'ไม่มีในข้อมูลดิบ' },
  { key: S_DELETED, label: 'ถูกลบจากระบบ' },
  { key: S_NEW, label: 'เพิ่มใหม่จากดิบ' },
  { key: S_SAME, label: 'ตรงกับดิบ' },
  { key: 'all', label: 'ทั้งหมด' },
]

const PAGE = 50

// ช่วงวันที่ลัด คิดตามเวลาไทย (YYYY-MM-DD)
type PresetKey = 'today' | 'yesterday' | 'last7' | 'thisMonth' | 'lastMonth'
const bkkToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
const addDays = (ymd: string, n: number) => {
  const d = new Date(ymd + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export function presetRange(k: PresetKey): [string, string] {
  const t = bkkToday()
  if (k === 'today') return [t, t]
  if (k === 'yesterday') return [addDays(t, -1), addDays(t, -1)]
  if (k === 'last7') return [addDays(t, -6), t]
  const first = t.slice(0, 8) + '01'
  if (k === 'thisMonth') return [first, t]
  const lastEnd = addDays(first, -1)
  return [lastEnd.slice(0, 8) + '01', lastEnd]
}

interface ViewRow {
  encounter_id: string
  raw_pairs: string | null
  cur_pairs: string | null
  first_uploaded: string | null
  status: string
  discharge_date: string | null
  last_updated: string | null
  /** อีเมลผู้ทำล่าสุด (แก้ / ลบ / เพิ่มใหม่จากดิบ) — แก้ก่อนเริ่มบันทึกผู้แก้ไม่ทราบผู้ทำ */
  last_editor?: string | null
  restored_at?: string | null
}
interface EventRow {
  event: 'deleted' | 'restored'
  admission_id: number | null
  coverage_code: string | null
  payer_id: string | null
  at: string
  by_email: string | null
  raw_id: number | null
  source_file: string | null
  file_date: string | null
  raw_uploaded_at: string | null
}
interface RawRow {
  raw_id: number
  batch_id: string
  file_date: string | null
  batch_kind: string
  source_file: string | null
  uploaded_at: string
  hn: string | null
  an: string | null
  coverage_code: string | null
  coverage_name: string | null
  payer_id: string | null
  payer_name: string | null
  discharge_date: string | null
  division_code: string | null
}
interface CurRow {
  admission_id: number
  coverage_code: string
  payer_id: string
  discharge_date: string | null
  division_code: string | null
  created_at: string
  updated_at: string | null
}

const inputCls =
  'rounded-lg border border-ink/25 bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/60'

// ทำให้ค่า NULL / ว่าง ของดิบเทียบกับ UNK ในระบบได้ (ใช้กฎเดียวกับ view ฝั่งฐานข้อมูล)
const norm = (v: string | null | undefined) => {
  const t = (v ?? '').trim().toUpperCase()
  return t === '' || t === 'NULL' ? 'UNK' : t
}
const pairOf = (c: string | null, p: string | null) => `${norm(c)}/${norm(p)}`

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtDateTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
}

function statusCls(s: string) {
  if (s === S_SAME) return 'bg-emerald-100 text-emerald-800'
  if (s === S_DIFF) return 'bg-amber-100 text-amber-900'
  if (s === S_NORAW) return 'bg-sky-100 text-sky-900'
  if (s === S_NEW) return 'bg-violet-100 text-violet-800'
  return 'bg-red-100 text-red-800'
}

function Detail({ enc }: { enc: string }) {
  const [raw, setRaw] = useState<RawRow[] | null>(null)
  const [cur, setCur] = useState<CurRow[] | null>(null)
  const [events, setEvents] = useState<EventRow[]>([])
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [r, c, ev] = await Promise.all([
        supabase
          .from('admissions_raw')
          .select('raw_id,batch_id,file_date,batch_kind,source_file,uploaded_at,hn,an,coverage_code,coverage_name,payer_id,payer_name,discharge_date,division_code')
          .eq('encounter_id', enc)
          .order('uploaded_at')
          .order('raw_id'),
        supabase
          .from('admissions')
          .select('admission_id,coverage_code,payer_id,discharge_date,division_code,created_at,updated_at')
          .eq('encounter_id', Number(enc)),
        // ประวัติเพิ่ม/ลบ — ถ้ายังไม่ได้รัน SQL สร้าง view จะ error → แสดงเป็นว่าง ไม่กระทบส่วนอื่น
        supabase.from('v_admission_events').select('*').eq('encounter_id', enc).order('at'),
      ])
      if (!alive) return
      if (r.error || c.error) {
        setErr((r.error ?? c.error)?.message ?? 'โหลดไม่สำเร็จ')
        return
      }
      setRaw((r.data ?? []) as RawRow[])
      setCur((c.data ?? []) as CurRow[])
      setEvents(ev.error ? [] : ((ev.data ?? []) as EventRow[]))
    })()
    return () => {
      alive = false
    }
  }, [enc])

  if (err) return <p className="p-3 text-sm text-red-700">{err}</p>
  if (!raw || !cur) return <p className="p-3 text-sm text-ink/60">กำลังโหลด…</p>

  const curSet = new Set(cur.map((x) => pairOf(x.coverage_code, x.payer_id)))
  const rawSet = new Set(raw.map((x) => pairOf(x.coverage_code, x.payer_id)))

  return (
    <div className="grid gap-4 p-3 lg:grid-cols-2">
      <div>
        <h4 className="mb-1.5 text-sm font-semibold text-ink">ข้อมูลดิบที่อัปโหลด ({raw.length} แถว)</h4>
        {raw.length === 0 ? (
          <p className="text-sm text-ink/60">ไม่มีในข้อมูลดิบ</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-ink/60">
                <th className="py-1 pr-2">ไฟล์ / วันที่</th>
                <th className="py-1 pr-2">สิทธิ</th>
                <th className="py-1 pr-2">ผู้จ่าย</th>
                <th className="py-1 pr-2">จำหน่าย</th>
                <th className="py-1">หอ</th>
              </tr>
            </thead>
            <tbody>
              {raw.map((x) => {
                const same = curSet.has(pairOf(x.coverage_code, x.payer_id))
                return (
                  <tr key={x.raw_id} className={'border-t border-ink/10 ' + (same ? '' : 'bg-amber-50')}>
                    <td className="py-1 pr-2">
                      {fmtDate(x.file_date)}
                      <span className="ml-1 text-ink/50">{x.batch_kind === 'snapshot' ? '(snapshot)' : '(อัปโหลด)'}</span>
                      {x.source_file && <div className="text-ink/50">{x.source_file}</div>}
                    </td>
                    <td className="py-1 pr-2 font-mono">{norm(x.coverage_code)}</td>
                    <td className="py-1 pr-2 font-mono">{norm(x.payer_id)}</td>
                    <td className="py-1 pr-2">{fmtDate(x.discharge_date)}</td>
                    <td className="py-1">{x.division_code ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      <div>
        <h4 className="mb-1.5 text-sm font-semibold text-ink">ข้อมูลในระบบปัจจุบัน ({cur.length} แถว)</h4>
        {cur.length === 0 ? (
          <p className="text-sm text-ink/60">ไม่มีในระบบ (ถูกลบ)</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-ink/60">
                <th className="py-1 pr-2">สิทธิ</th>
                <th className="py-1 pr-2">ผู้จ่าย</th>
                <th className="py-1 pr-2">จำหน่าย</th>
                <th className="py-1 pr-2">หอ</th>
                <th className="py-1">สร้าง / แก้ล่าสุด</th>
              </tr>
            </thead>
            <tbody>
              {cur.map((x) => {
                const same = rawSet.has(pairOf(x.coverage_code, x.payer_id))
                return (
                  <tr key={x.admission_id} className={'border-t border-ink/10 ' + (same ? '' : 'bg-amber-50')}>
                    <td className="py-1 pr-2 font-mono">{x.coverage_code}</td>
                    <td className="py-1 pr-2 font-mono">{x.payer_id}</td>
                    <td className="py-1 pr-2">{fmtDate(x.discharge_date)}</td>
                    <td className="py-1 pr-2">{x.division_code ?? '—'}</td>
                    <td className="py-1 text-ink/70">
                      {fmtDateTime(x.created_at)}
                      {x.updated_at && x.updated_at !== x.created_at && <div>แก้ {fmtDateTime(x.updated_at)}</div>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      {events.length > 0 && (
        <div className="lg:col-span-2">
          <h4 className="mb-1.5 text-sm font-semibold text-ink">ประวัติ เพิ่ม / ลบ ของเคสนี้ ({events.length} เหตุการณ์)</h4>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-ink/60">
                <th className="py-1 pr-2">เวลา</th>
                <th className="py-1 pr-2">เหตุการณ์</th>
                <th className="py-1 pr-2">สิทธิ/ผู้จ่าย</th>
                <th className="py-1 pr-2">รหัสแถว</th>
                <th className="py-1 pr-2">โดย</th>
                <th className="py-1">แถวดิบต้นทาง</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={i} className="border-t border-ink/10">
                  <td className="py-1 pr-2">{fmtDateTime(e.at)}</td>
                  <td className="py-1 pr-2">
                    <span className={'rounded-full px-2 py-0.5 font-semibold ' + (e.event === 'restored' ? 'bg-violet-100 text-violet-800' : 'bg-red-100 text-red-800')}>
                      {e.event === 'restored' ? 'เพิ่มใหม่จากดิบ' : 'ถูกลบจากระบบ'}
                    </span>
                  </td>
                  <td className="py-1 pr-2 font-mono">{norm(e.coverage_code)}/{norm(e.payer_id)}</td>
                  <td className="py-1 pr-2 font-mono">{e.admission_id ?? '—'}</td>
                  <td className="py-1 pr-2">{e.by_email ?? <span className="text-ink/50">ไม่ทราบ</span>}</td>
                  <td className="py-1 text-ink/70">
                    {e.raw_id != null ? (
                      <>
                        raw #{e.raw_id}
                        {e.source_file && <span className="ml-1">· {e.source_file}</span>}
                        {e.file_date && <span className="ml-1">· ไฟล์วันที่ {fmtDate(e.file_date)}</span>}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-ink/50 lg:col-span-2">
        แถวที่ไฮไลต์สีเหลือง = คู่ สิทธิ/ผู้จ่าย ที่ไม่มีอยู่อีกฝั่ง · ข้อมูลดิบเก็บแบบเพิ่มอย่างเดียว ไม่ถูกแก้หรือลบ
      </p>
    </div>
  )
}

export default function RawCompareView({ presetNonce = 0 }: { presetNonce?: number }) {
  const [filter, setFilter] = useState('diff_all')
  const [q, setQ] = useState('')
  const [applied, setApplied] = useState('')
  // ช่วงวันที่ (YYYY-MM-DD): วันที่จำหน่าย / วันที่แก้ไขล่าสุดในระบบ — ว่าง = ไม่กรอง, ใส่วันเดียว = วันนั้นวันเดียว
  const [disFrom, setDisFrom] = useState('')
  const [disTo, setDisTo] = useState('')
  const [updFrom, setUpdFrom] = useState('')
  const [updTo, setUpdTo] = useState('')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<ViewRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // เคสที่เพิ่งเพิ่มจากดิบ: ปักไว้บนสุดและกางรายละเอียดชั่วครู่ แล้วหุบกลับเอง
  const [pinned, setPinned] = useState<ViewRow | null>(null)
  const flashTimer = useRef<number | null>(null)
  const sheetPush = useSheetPush(true)

  useEffect(
    () => () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current)
    },
    [],
  )

  function endFlashLater(enc: string | null) {
    if (flashTimer.current) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => {
      setPinned(null)
      setNotice(null)
      if (enc) setOpen((o) => (o === enc ? null : o))
    }, FLASH_MS)
  }

  // สร้างเคสที่ถูกลบกลับเข้าระบบจากข้อมูลดิบ (ฟังก์ชันฝั่ง DB อ่านดิบอย่างเดียว ไม่แก้ดิบ)
  async function restoreFromRaw(enc: string) {
    if (!window.confirm(`เพิ่มเคส encounter ${enc} เข้าระบบจากข้อมูลดิบ?\n(ข้อมูลดิบจะไม่ถูกแก้ไข)`)) return
    setRestoring(enc)
    setErr(null)
    setNotice(null)
    const { data, error } = await supabase.rpc('restore_admission_from_raw', { p_encounter_id: enc })
    setRestoring(null)
    if (error) {
      setErr(error.message)
      return
    }
    const n = (data as { admissions_inserted?: number } | null)?.admissions_inserted ?? 0
    if (n === 0) {
      setNotice(`เคส ${enc} มีในระบบอยู่แล้ว ไม่มีการเพิ่ม`)
      void load()
      endFlashLater(null)
      return
    }
    setNotice(`เพิ่มเคส ${enc} เข้าระบบแล้ว ${n} สิทธิ/ผู้จ่าย (ข้อมูลดิบไม่ถูกแก้ไข · บันทึกประวัติผู้เพิ่มแล้ว)`)
    // รีเฟรชรายการ + ปักเคสที่เพิ่มไว้บนสุดและกางรายละเอียดให้ตรวจ
    const { data: row } = await supabase.from('v_raw_vs_current').select('*').eq('encounter_id', enc).maybeSingle()
    if (row) {
      setPinned(row as ViewRow)
      setOpen(enc)
    }
    void load()
    // ส่งไป Google Sheet ต่อทันที เหมือนตอนลบ/นำเข้า (ถ้า Google ขัดข้อง เคสยังถูกเพิ่มในระบบเรียบร้อย)
    await sheetPush.push()
    endFlashLater(enc)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    let qb = supabase.from('v_raw_vs_current').select('*', { count: 'exact' })
    if (filter === 'diff_all') qb = qb.neq('status', S_SAME)
    else if (filter === 'alert') qb = qb.in('status', [S_DIFF, S_DELETED])
    else if (filter !== 'all') qb = qb.eq('status', filter)
    if (applied) qb = qb.eq('encounter_id', applied)
    if (disFrom || disTo) {
      const a = disFrom || disTo
      const b = disTo || disFrom
      qb = qb.gte('discharge_date', a <= b ? a : b).lte('discharge_date', a <= b ? b : a)
    }
    if (updFrom || updTo) {
      const a = updFrom || updTo
      const b = updTo || updFrom
      const lo = a <= b ? a : b
      const hi = a <= b ? b : a
      // วันตามเวลาไทย (UTC+7): ตั้งแต่ 00:00 ของวันเริ่ม ถึงก่อน 00:00 ของวันถัดจากวันสุดท้าย
      const next = new Date(hi + 'T00:00:00+07:00')
      next.setDate(next.getDate() + 1)
      qb = qb.gte('last_updated', lo + 'T00:00:00+07:00').lt('last_updated', next.toISOString())
    }
    const { data, count, error } = await qb
      .order('encounter_id', { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1)
    setLoading(false)
    if (error) {
      setErr(error.message)
      return
    }
    setRows((data ?? []) as ViewRow[])
    setTotal(count ?? 0)
  }, [filter, applied, disFrom, disTo, updFrom, updTo, page])

  useEffect(() => {
    void load()
  }, [load])

  // เปิดจากการ์ดแจ้งเตือน: ตั้งตัวกรอง = 2 สถานะที่ต้องตรวจ + วันที่แก้ไขเมื่อวาน
  useEffect(() => {
    if (presetNonce === 0) return
    const y = presetRange('yesterday')
    setFilter('alert')
    setApplied('')
    setQ('')
    setDisFrom('')
    setDisTo('')
    setUpdFrom(y[0])
    setUpdTo(y[1])
    setPage(0)
    setOpen(null)
  }, [presetNonce])

  const pages = Math.max(1, Math.ceil(total / PAGE))

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-surface p-4 shadow-sm">
        <h2 className="text-base font-semibold text-ink">เทียบข้อมูลระบบปกติ กับ ข้อมูลดิบที่อัปโหลด</h2>
        <p className="mt-0.5 text-sm text-ink/60">
          ไม่แก้ข้อมูลดิบ และไม่เกี่ยวกับการส่ง Google Sheet · เคส "ถูกลบจากระบบ" เพิ่มกลับเข้าระบบจากดิบได้ (บันทึกประวัติผู้เพิ่ม) · ระดับ encounter เทียบคู่ สิทธิ/ผู้จ่าย
        </p>
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            setPage(0)
            setOpen(null)
            setApplied(q.trim())
          }}
        >
          <select
            className={inputCls}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value)
              setPage(0)
              setOpen(null)
            }}
          >
            {FILTERS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
          <input
            className={inputCls + ' w-48'}
            inputMode="numeric"
            placeholder="ค้นหา encounter_id"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Button type="submit">ค้นหา</Button>
          {applied && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setQ('')
                setApplied('')
                setPage(0)
              }}
            >
              ล้าง
            </Button>
          )}
          <span className="ml-auto text-sm text-ink/60">{loading ? 'กำลังโหลด…' : `${total.toLocaleString('th-TH')} encounter`}</span>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink/70">
          <DateRange
            label="วันที่จำหน่าย"
            from={disFrom}
            to={disTo}
            onChange={(f, t) => {
              setDisFrom(f)
              setDisTo(t)
              setPage(0)
              setOpen(null)
            }}
          />
          <DateRange
            label="วันที่แก้ไข"
            from={updFrom}
            to={updTo}
            onChange={(f, t) => {
              setUpdFrom(f)
              setUpdTo(t)
              setPage(0)
              setOpen(null)
            }}
          />
          <span className="text-xs text-ink/50">วันที่แก้ไข = ครั้งล่าสุดที่แถวในระบบถูกแก้/อัปเดตหลังสร้าง · ใส่วันเดียว = เฉพาะวันนั้น</span>
        </div>
      </div>

      {err && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</p>}
      {notice && (
        <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          <p>{notice}</p>
          {sheetPush.status.phase !== 'idle' && sheetPush.status.phase !== 'error' && <p className="mt-0.5 text-emerald-900/80">{sheetPush.status.message}</p>}
        </div>
      )}
      {sheetPush.status.phase === 'error' && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {sheetPush.status.message} — เคสถูกเพิ่มในระบบแล้ว กดปุ่ม “ส่งไป Google Sheet” ที่หน้าหลักเพื่อส่งซ้ำได้
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl bg-surface shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left text-xs text-ink/60">
              <th className="px-3 py-2">Encounter ID</th>
              <th className="px-3 py-2">สถานะ</th>
              <th className="px-3 py-2">ดิบ (สิทธิ/ผู้จ่าย)</th>
              <th className="px-3 py-2">ระบบปัจจุบัน (สิทธิ/ผู้จ่าย)</th>
              <th className="px-3 py-2">วันที่จำหน่าย</th>
              <th className="px-3 py-2">แก้ไขล่าสุด</th>
              <th className="px-3 py-2">แก้ไขโดย</th>
              <th className="px-3 py-2">ดิบครั้งแรก</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {pinned && (
              <FragmentRow
                key={'pin-' + pinned.encounter_id}
                r={pinned}
                highlight
                open={open === pinned.encounter_id}
                onToggle={() => setOpen(open === pinned.encounter_id ? null : pinned.encounter_id)}
                restoring={false}
                busy={restoring !== null}
                onRestore={() => void restoreFromRaw(pinned.encounter_id)}
              />
            )}
            {rows
              .filter((r) => r.encounter_id !== pinned?.encounter_id)
              .map((r) => (
              <FragmentRow
                key={r.encounter_id}
                r={r}
                open={open === r.encounter_id}
                onToggle={() => setOpen(open === r.encounter_id ? null : r.encounter_id)}
                restoring={restoring === r.encounter_id}
                busy={restoring !== null}
                onRestore={() => void restoreFromRaw(r.encounter_id)}
              />
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-ink/60">
                  ไม่พบรายการ
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button type="button" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            ‹ ก่อนหน้า
          </Button>
          <span className="text-ink/70">
            หน้า {page + 1} / {pages}
          </span>
          <Button type="button" variant="outline" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
            ถัดไป ›
          </Button>
        </div>
      )}
    </div>
  )
}

function FragmentRow({
  r,
  highlight = false,
  open,
  onToggle,
  restoring,
  busy,
  onRestore,
}: {
  r: ViewRow
  highlight?: boolean
  open: boolean
  onToggle: () => void
  restoring: boolean
  busy: boolean
  onRestore: () => void
}) {
  return (
    <>
      <tr className={'cursor-pointer border-b border-ink/10 hover:bg-brand/10 ' + (highlight ? 'bg-violet-50' : '')} onClick={onToggle}>
        <td className="px-3 py-2 font-mono">{r.encounter_id}</td>
        <td className="px-3 py-2">
          <span className={'rounded-full px-2 py-0.5 text-xs font-semibold ' + statusCls(r.status)}>{r.status}</span>
        </td>
        <td className="px-3 py-2 font-mono text-xs">{r.raw_pairs ?? '—'}</td>
        <td className="px-3 py-2 font-mono text-xs">{r.cur_pairs ?? '—'}</td>
        <td className="px-3 py-2 text-xs">{fmtDate(r.discharge_date)}</td>
        <td className="px-3 py-2 text-xs">{fmtDateTime(r.last_updated)}</td>
        <td className="px-3 py-2 text-xs">
          {r.last_editor ?? (r.last_updated ? <span className="text-ink/50">ไม่ทราบ (แก้ก่อนเริ่มบันทึกผู้แก้)</span> : '—')}
        </td>
        <td className="px-3 py-2 text-xs text-ink/70">{fmtDateTime(r.first_uploaded)}</td>
        <td className="px-3 py-2 text-right">
          {r.status === S_DELETED && (
            <Button
              type="button"
              variant="primary"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation()
                onRestore()
              }}
            >
              {restoring ? 'กำลังเพิ่ม…' : '+ เพิ่มเคสจากดิบ'}
            </Button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-ink/10 bg-ink/[0.03]">
          <td colSpan={9}>
            <Detail enc={r.encounter_id} />
          </td>
        </tr>
      )}
    </>
  )
}

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'today', label: 'วันนี้' },
  { key: 'yesterday', label: 'เมื่อวาน' },
  { key: 'last7', label: '7 วันล่าสุด' },
  { key: 'thisMonth', label: 'เดือนนี้' },
  { key: 'lastMonth', label: 'เดือนที่แล้ว' },
]

function DateRange({ label, from, to, onChange }: { label: string; from: string; to: string; onChange: (f: string, t: string) => void }) {
  const cls = inputCls + ' py-1'
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span>{label}</span>
      <input type="date" className={cls} value={from} onChange={(e) => onChange(e.target.value, to)} />
      <span>–</span>
      <input type="date" className={cls} value={to} onChange={(e) => onChange(from, e.target.value)} />
      {PRESETS.map((p) => {
        const r = presetRange(p.key)
        const on = from === r[0] && to === r[1]
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => onChange(r[0], r[1])}
            className={'rounded-full border px-2.5 py-0.5 text-xs font-semibold ' + (on ? 'border-brand bg-brand text-ink' : 'border-ink/25 text-ink/70 hover:bg-brand/20')}
          >
            {p.label}
          </button>
        )
      })}
      {(from || to) && (
        <button type="button" className="text-xs underline" onClick={() => onChange('', '')}>
          ล้าง
        </button>
      )}
    </div>
  )
}
