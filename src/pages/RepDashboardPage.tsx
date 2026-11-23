import { useCallback, useEffect, useMemo, useState } from 'react'
import Button from '../components/ui/Button'
import RepFilterBar from '../components/RepFilterBar'
import { useAuth } from '../contexts/AuthContext'
import { buildSummary, loadNames, loadRepRows, RESULT_LABEL, type RepResult, type RepRow } from '../lib/repDashboard'
import { exportRepDashboard } from '../lib/exportRep'
import { EMPTY_FILTERS, matchFilters, pairsOf, type RepFilters } from '../lib/repFilters'

/**
 * ผลตอบกลับ REP — dashboard รวมจากไฟล์ตอบกลับที่บันทึกไว้ที่หน้า "ตั้งหนี้ SAP" แมปกับข้อมูลเคสของเรา
 * 1 แถว = 1 เคส (REP ล่าสุดของเคส) · ตารางสรุปแยกสิทธิ × ผู้จ่าย → เลข REP · ตัวกรองมีผลกับ Export
 */

const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '–')
const th = 'whitespace-nowrap px-2 py-2 text-xs font-semibold'
const td = 'px-2 py-2 align-top'

type StatusFilter = 'all' | RepResult

const BADGE: Record<RepResult, string> = {
  passed: 'border-line bg-surface text-ink',
  c: 'border-rose/40 bg-rose-soft text-rose',
  other: 'border-line bg-surface text-ink/70',
}

export default function RepDashboardPage() {
  const { role, roleLoading } = useAuth()
  const allowed = role === 'admin' || role === 'user'
  const [rows, setRows] = useState<RepRow[]>([])
  const [names, setNames] = useState<{ coverage: Map<string, string>; payer: Map<string, string> }>({ coverage: new Map(), payer: new Map() })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)

  const [filters, setFilters] = useState<RepFilters>(EMPTY_FILTERS)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [q, setQ] = useState('')
  /** เลือกจากตารางสรุป: ดูเฉพาะเลข REP นั้นของสิทธิ/ผู้จ่ายนั้น */
  const [sel, setSel] = useState<{ cov: string; payer: string; repNo: string } | null>(null)
  const [exporting, setExporting] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [r, n] = await Promise.all([loadRepRows(), loadNames()])
      setRows(r)
      setNames(n)
      setError(null)
      setLoadedAt(new Date())
    } catch (e) {
      setError(`โหลดผลตอบกลับ REP ไม่สำเร็จ: ${(e as { message?: string })?.message ?? String(e)}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (allowed) void reload()
  }, [allowed, reload])

  const pairs = useMemo(() => pairsOf(rows), [rows])

  // ตัวกรองหลัก (สิทธิ/ผู้จ่าย/วันที่) → ใช้กับทั้งตารางสรุปและรายการ
  const base = useMemo(() => rows.filter((r) => matchFilters(r, filters)), [rows, filters])
  const summary = useMemo(() => buildSummary(base), [base])

  const rowsShown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return base
      .filter((r) => status === 'all' || r.result === status)
      .filter((r) => !sel || (r.coverageCode ?? '–') === sel.cov && (r.payerId ?? '–') === sel.payer && r.repNo === sel.repNo)
      .filter(
        (r) =>
          !needle ||
          String(r.encounterId).includes(needle) ||
          (r.hn ?? '').toLowerCase().includes(needle) ||
          (r.name ?? '').toLowerCase().includes(needle) ||
          (r.currentClaimNo ?? '').toLowerCase().includes(needle) ||
          r.repNo.toLowerCase().includes(needle),
      )
  }, [base, status, sel, q])

  const cnt = (s: RepResult) => base.filter((r) => r.result === s).length
  const unmatched = rows.filter((r) => r.unmatched).length

  async function doExport() {
    setExporting(true)
    try {
      await exportRepDashboard(rowsShown, buildSummary(rowsShown))
    } catch (e) {
      setError(`Export ไม่สำเร็จ: ${(e as { message?: string })?.message ?? String(e)}`)
    } finally {
      setExporting(false)
    }
  }

  if (roleLoading || role === null) return <main className="px-4 py-6 text-sm text-ink/70 sm:px-8">กำลังโหลด…</main>
  if (!allowed) {
    return (
      <main className="w-full px-4 py-6 sm:px-8">
        <div className="rounded-xl border border-line bg-surface p-4 text-sm text-ink">หน้าผลตอบกลับ REP แสดงชื่อผู้ป่วยและข้อมูลเบิก จึงเปิดให้ admin / user / developer เท่านั้น</div>
      </main>
    )
  }

  // รวมยอดรายสิทธิ × ผู้จ่าย (แถวสรุปท้ายกลุ่ม)
  const groups = new Map<string, typeof summary>()
  for (const l of summary) groups.set(`${l.coverageCode}|${l.payerId}`, [...(groups.get(`${l.coverageCode}|${l.payerId}`) ?? []), l])

  return (
    <main className="w-full space-y-4 px-4 py-6 sm:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">ผลตอบกลับ REP</h1>
          <p className="mt-1 text-sm text-ink/70">รวมผลตอบกลับจากไฟล์ REP ที่บันทึกไว้ที่หน้า "ตั้งหนี้ SAP" แมปกับข้อมูลเคสของเรา · แสดง REP ล่าสุดของแต่ละเคส</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-ink/60">
          {loadedAt && <span>อัปเดตล่าสุด {loadedAt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
          <Button type="button" variant="outline" onClick={() => void reload()} disabled={loading}>
            {loading ? 'กำลังโหลด…' : 'รีเฟรช'}
          </Button>
          <Button type="button" onClick={() => void doExport()} disabled={exporting || rowsShown.length === 0}>
            {exporting ? 'กำลังสร้างไฟล์…' : '⬇ Export Excel'}
          </Button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-rose/30 bg-rose-soft/50 px-4 py-2 text-sm text-rose">{error}</div>}
      {unmatched > 0 && (
        <div className="rounded-lg border border-rose/30 bg-rose-soft/50 px-4 py-2 text-sm text-rose">
          มี {unmatched} รายการใน REP ที่ยังจับคู่เคสในระบบไม่ได้ (แสดงในตารางด้านล่างโดยไม่มีสิทธิ/HN) — ตรวจที่หน้า "ตั้งหนี้ SAP"
        </div>
      )}

      <RepFilterBar value={filters} onChange={(f) => { setFilters(f); setSel(null) }} pairs={pairs} coverageNames={names.coverage} payerNames={names.payer} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="เคสทั้งหมดตามตัวกรอง" value={base.length} active={status === 'all'} onClick={() => setStatus('all')} />
        <Stat label="ผ่าน" value={cnt('passed')} sub="REP ล่าสุดเป็น A" active={status === 'passed'} onClick={() => setStatus(status === 'passed' ? 'all' : 'passed')} />
        <Stat label="ติด C" value={cnt('c')} sub={`ส่งแก้แล้ว รอผล ${base.filter((r) => r.resent).length}`} warn={cnt('c') > 0} active={status === 'c'} onClick={() => setStatus(status === 'c' ? 'all' : 'c')} />
        <Stat label="อื่น ๆ" value={cnt('other')} sub="เช่น T" active={status === 'other'} onClick={() => setStatus(status === 'other' ? 'all' : 'other')} />
      </div>

      {/* ตารางรวมผลตอบกลับ แยกสิทธิ × ผู้จ่าย × เลข REP */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-ink">สรุปแยกตามสิทธิและเลข REP <span className="font-normal text-ink/60">(กดแถวเพื่อดูเฉพาะเลข REP นั้น)</span></h2>
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[760px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="bg-brand text-ink">
                <th className={th}>สิทธิ / ผู้จ่าย</th>
                <th className={th}>เลข REP</th>
                <th className={th}>วันที่ตอบกลับ</th>
                <th className={th + ' text-right'}>เคส</th>
                <th className={th + ' text-right'}>ผ่าน</th>
                <th className={th + ' text-right'}>ติด C</th>
                <th className={th + ' text-right'}>อื่น ๆ</th>
              </tr>
            </thead>
            <tbody>
              {summary.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-ink/60">
                    {loading ? 'กำลังโหลด…' : rows.length === 0 ? 'ยังไม่มีข้อมูล — บันทึกไฟล์ REP ที่หน้า "ตั้งหนี้ SAP" ก่อน' : 'ไม่พบข้อมูลตามตัวกรอง'}
                  </td>
                </tr>
              )}
              {[...groups.entries()].map(([k, lines]) => {
                const [cov, payer] = k.split('|')
                const sum = lines.reduce((a, l) => ({ total: a.total + l.total, passed: a.passed + l.passed, c: a.c + l.c, other: a.other + l.other }), { total: 0, passed: 0, c: 0, other: 0 })
                return (
                  <GroupRows key={k} cov={cov} payer={payer} covName={names.coverage.get(cov)} payerName={names.payer.get(payer)} lines={lines} sum={sum} sel={sel} onPick={(l) => setSel(sel && sel.cov === l.coverageCode && sel.payer === l.payerId && sel.repNo === l.repNo ? null : { cov: l.coverageCode, payer: l.payerId, repNo: l.repNo })} />
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* รายการรายเคส */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-bold text-ink">ผลตอบกลับรายเคส</h2>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหา encounter_id / HN / ชื่อ / เลขตั้งเบิก / เลข REP"
            className="min-w-[260px] flex-1 rounded-lg border border-ink/30 bg-surface px-3 py-2 text-sm text-ink"
          />
          {sel && (
            <button type="button" onClick={() => setSel(null)} className="rounded-lg border border-ink/30 bg-brand-soft px-3 py-1.5 text-xs font-semibold text-ink">
              REP {sel.repNo} · {sel.cov}/{sel.payer} ✕
            </button>
          )}
          <span className="text-xs text-ink/60">{rowsShown.length} เคส</span>
        </div>
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[1100px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="bg-brand text-ink">
                <th className={th}>encounter_id</th>
                <th className={th}>HN</th>
                <th className={th}>ชื่อผู้ป่วย</th>
                <th className={th}>วันจำหน่าย</th>
                <th className={th}>สิทธิ / ผู้จ่าย</th>
                <th className={th}>เลขตั้งเบิกปัจจุบัน</th>
                <th className={th}>REP ล่าสุด</th>
                <th className={th}>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {rowsShown.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-ink/60">
                    {loading ? 'กำลังโหลด…' : 'ไม่พบเคสตามตัวกรอง'}
                  </td>
                </tr>
              )}
              {rowsShown.map((r) => (
                <tr key={r.key} className="border-b border-line hover:bg-paper">
                  <td className={td + ' tabular-nums'}>{r.encounterId}</td>
                  <td className={td + ' whitespace-nowrap'}>{r.hn ?? '–'}</td>
                  <td className={td}>{r.name ?? '–'}</td>
                  <td className={td + ' whitespace-nowrap'}>{fmtDate(r.dischargeDate)}</td>
                  <td className={td + ' whitespace-nowrap'}>{r.coverageCode ? `${r.coverageCode} / ${r.payerId}` : <span className="text-rose">ยังไม่จับคู่เคส</span>}</td>
                  <td className={td + ' whitespace-nowrap'}>
                    {r.currentClaimNo ?? '–'}
                    <div className="text-xs text-ink/60">ส่งเบิก {fmtDate(r.submissionDate)}</div>
                  </td>
                  <td className={td + ' whitespace-nowrap'}>
                    REP {r.repNo}
                    <div className="text-xs text-ink/60">ตอบกลับ {fmtDate(r.replyDate)}</div>
                  </td>
                  <td className={td}>
                    <span className={'whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-semibold ' + BADGE[r.result]}>{RESULT_LABEL(r)}</span>
                    {r.resent && <div className="mt-1 text-[11px] text-ink/60">ส่งแก้แล้ว รอผล</div>}
                    {r.result === 'passed' && r.cRounds > 0 && <div className="mt-1 text-[11px] text-ink/60">เคยติด C {r.cRounds} รอบ</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}

function GroupRows({
  cov, payer, covName, payerName, lines, sum, sel, onPick,
}: {
  cov: string
  payer: string
  covName?: string
  payerName?: string
  lines: ReturnType<typeof buildSummary>
  sum: { total: number; passed: number; c: number; other: number }
  sel: { cov: string; payer: string; repNo: string } | null
  onPick: (l: ReturnType<typeof buildSummary>[number]) => void
}) {
  return (
    <>
      {lines.map((l, i) => {
        const on = !!sel && sel.cov === l.coverageCode && sel.payer === l.payerId && sel.repNo === l.repNo
        return (
          <tr key={l.repNo} className={'cursor-pointer border-b border-line hover:bg-paper ' + (on ? 'bg-brand-soft' : '')} onClick={() => onPick(l)}>
            <td className={td}>
              {i === 0 && (
                <>
                  <div className="font-semibold">{cov} / {payer}</div>
                  <div className="text-xs text-ink/60">{[covName, payerName].filter(Boolean).join(' · ')}</div>
                </>
              )}
            </td>
            <td className={td + ' font-semibold'}>{l.repNo}</td>
            <td className={td + ' whitespace-nowrap'}>{fmtDate(l.replyDate)}</td>
            <td className={td + ' text-right tabular-nums'}>{l.total}</td>
            <td className={td + ' text-right tabular-nums'}>{l.passed}</td>
            <td className={td + ' text-right tabular-nums ' + (l.c > 0 ? 'font-semibold text-rose' : '')}>{l.c}</td>
            <td className={td + ' text-right tabular-nums'}>{l.other}</td>
          </tr>
        )
      })}
      {lines.length > 1 && (
        <tr className="border-b border-line bg-paper text-xs font-semibold">
          <td className={td} colSpan={3}>รวม {cov} / {payer}</td>
          <td className={td + ' text-right tabular-nums'}>{sum.total}</td>
          <td className={td + ' text-right tabular-nums'}>{sum.passed}</td>
          <td className={td + ' text-right tabular-nums'}>{sum.c}</td>
          <td className={td + ' text-right tabular-nums'}>{sum.other}</td>
        </tr>
      )}
    </>
  )
}

function Stat({ label, value, sub, warn, active, onClick }: { label: string; value: number; sub?: string; warn?: boolean; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={'rounded-xl border p-4 text-left transition-colors ' + (active ? 'border-ink bg-brand ' : warn ? 'border-rose/30 bg-rose-soft/50 hover:bg-rose-soft ' : 'border-line bg-surface hover:bg-brand-soft ')}
    >
      <div className="text-xs text-ink/70">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums text-ink">{value}</div>
      {sub && <div className="text-xs text-ink/70">{sub}</div>}
    </button>
  )
}
