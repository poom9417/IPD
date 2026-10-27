import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  BUCKETS,
  buildSummary,
  fetchSummaryRows,
  todayYmd,
  type GroupSummary,
  type SummaryRow,
} from '../lib/arSummary'
import { exportArSummaryToExcel } from '../lib/exportArSummary'
import { copyElementAsImage } from '../lib/copyTableImage'
import { useAuth } from '../contexts/AuthContext'
import WaveExportButton from './WaveExportButton'

const money = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const count = (n: number) => n.toLocaleString('th-TH')
const pct = (v: number | null) => (v === null ? '–' : (v * 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%')

const inputCls =
  'rounded-lg border border-ink/25 bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/60'

// หัวคอลัมน์ย่อย "ราย" / "เงิน" — ใช้ซ้ำทุกกลุ่ม
function SubHead({ cols }: { cols: number }) {
  return (
    <>
      {Array.from({ length: cols }).map((_, i) => (
        <Fragment key={i}>
          <th className="whitespace-nowrap border-l border-ink/15 px-2 py-2 text-right text-xs font-semibold">ราย</th>
          <th className="whitespace-nowrap px-2 py-2 text-right text-xs font-semibold">เงิน (บาท)</th>
        </Fragment>
      ))}
    </>
  )
}

function Cells({ n, amt, muted }: { n: number; amt: number; muted?: boolean }) {
  const cls = 'whitespace-nowrap px-2 py-2.5 text-right tabular-nums ' + (muted ? 'text-ink/50' : 'text-ink')
  const zero = n === 0
  return (
    <>
      <td className={cls + ' border-l border-line'}>{zero ? '–' : count(n)}</td>
      <td className={cls}>{zero ? '–' : money(amt)}</td>
    </>
  )
}

function GroupRow({ g, bold }: { g: GroupSummary; bold?: boolean }) {
  return (
    <tr className={'border-b border-line ' + (bold ? 'bg-brand-soft font-bold' : 'hover:bg-paper')}>
      <td
        className={
          'sticky left-0 z-10 min-w-[200px] px-2 py-2.5 text-ink ' + (bold ? 'bg-brand-soft' : 'bg-surface')
        }
      >
        {g.def.label}
      </td>
      <Cells n={g.pending.n} amt={g.pending.amt} />
      {BUCKETS.map((b, i) => (
        <Cells key={b.key} n={g.buckets[i].n} amt={g.buckets[i].amt} muted={b.withinTerm && !bold} />
      ))}
      <Cells n={g.overdue.n} amt={g.overdue.amt} />
      <td className="whitespace-nowrap border-l border-line px-2 py-2.5 text-right font-semibold tabular-nums text-ink">
        {pct(g.pctN)}
      </td>
      <td className="whitespace-nowrap px-2 py-2.5 text-right font-semibold tabular-nums text-ink">{pct(g.pctAmt)}</td>
    </tr>
  )
}

export default function ArSummaryDashboard() {
  const { role } = useAuth()
  // viewer: ดูได้แต่ Export ไม่ได้ (นโยบายความปลอดภัยข้อมูล เหมือนหน้าหลัก)
  const canExport = role !== 'viewer'
  const [rows, setRows] = useState<SummaryRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [asOf, setAsOf] = useState(todayYmd)
  const [tick, setTick] = useState(0)
  const tableRef = useRef<HTMLTableElement>(null)
  const [copyState, setCopyState] = useState<'idle' | 'busy' | 'copied' | 'downloaded' | 'error'>('idle')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchSummaryRows()
      .then((r) => {
        if (!cancelled) setRows(r)
      })
      .catch((e) => {
        if (!cancelled) setError((e as { message?: string })?.message ?? 'โหลดข้อมูลไม่สำเร็จ')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tick])

  // เปลี่ยนวันที่ "ณ" แล้วคำนวณใหม่ในเครื่องทันที (ไม่ยิง DB ซ้ำ)
  const summary = useMemo(() => (rows && asOf ? buildSummary(rows, asOf) : null), [rows, asOf])

  async function handleExport() {
    if (!canExport || !asOf) return
    await exportArSummaryToExcel(asOf, { role })
  }

  // คัดลอกเฉพาะตารางเป็นภาพ → วางใน PowerPoint / Canva
  async function handleCopyImage() {
    if (!canExport || !tableRef.current) return
    setCopyState('busy')
    try {
      setCopyState(await copyElementAsImage(tableRef.current))
    } catch {
      setCopyState('error')
    }
    setTimeout(() => setCopyState('idle'), 2500)
  }

  const asOfThai = asOf
    ? new Date(asOf + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—'

  return (
    <main data-tour="ar-summary" className="w-full space-y-4 px-4 py-6 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">IPD ค้างส่งเบิก รวมทุกสิทธิ</h1>
          <p className="mt-1 text-sm text-ink/70">
            นับเคสที่จำหน่ายแล้วและยังไม่ส่งเบิก ณ วันที่เลือก · อายุนับจากวันที่จำหน่ายถึงวันที่เลือก
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm text-ink/70">
            <div className="mb-1">ค้างส่งเบิก ณ วันที่</div>
            <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className={inputCls} />
          </label>
          <button
            type="button"
            onClick={() => setAsOf(todayYmd())}
            className="rounded-lg border border-ink/30 px-4 py-2 text-sm font-medium text-ink hover:bg-brand-soft hover:border-ink"
          >
            วันนี้
          </button>
          <button
            type="button"
            onClick={() => setTick((t) => t + 1)}
            disabled={loading}
            className="rounded-lg border border-ink/30 px-4 py-2 text-sm font-medium text-ink hover:bg-brand-soft hover:border-ink disabled:opacity-40"
          >
            {loading ? 'กำลังโหลด…' : 'โหลดข้อมูลใหม่'}
          </button>
          {canExport && (
            <button
              type="button"
              onClick={handleCopyImage}
              disabled={loading || !summary || copyState === 'busy'}
              title="คัดลอกเฉพาะตารางเป็นภาพ แล้ววางใน PowerPoint / Canva"
              className="rounded-lg border border-ink/30 px-4 py-2 text-sm font-medium text-ink hover:bg-brand-soft hover:border-ink disabled:opacity-40"
            >
              {copyState === 'busy'
                ? 'กำลังสร้างภาพ…'
                : copyState === 'copied'
                  ? '✓ คัดลอกแล้ว'
                  : copyState === 'downloaded'
                    ? '✓ ดาวน์โหลดภาพแล้ว'
                    : copyState === 'error'
                      ? 'คัดลอกไม่สำเร็จ'
                      : 'คัดลอกตาราง (ภาพ)'}
            </button>
          )}
          {canExport && (
            <WaveExportButton
              onExport={handleExport}
              disabled={loading || !summary || !asOf}
              title="ส่งออก 2 ชีต: ตารางรวม + รายการที่ค้างซึ่งนำมาคำนวณ ณ วันที่เลือก"
              label="Export Excel"
            />
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-lg border border-rose/30 bg-rose-soft/50 px-4 py-2 text-sm text-rose">
          <span>โหลดข้อมูลไม่สำเร็จ: {error}</span>
          <button onClick={() => setTick((t) => t + 1)} className="underline">
            ลองใหม่
          </button>
        </div>
      )}

      {!summary ? (
        <div className="rounded-xl border border-line bg-surface p-8 text-center text-sm text-ink/60">
          {loading ? 'กำลังโหลดข้อมูล…' : asOf ? 'ไม่มีข้อมูล' : 'เลือกวันที่ก่อน'}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table ref={tableRef} className="w-full min-w-[1240px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="bg-brand text-[13px] text-ink">
                  <th rowSpan={3} className="sticky left-0 z-10 min-w-[200px] bg-brand px-2 py-2 align-bottom font-semibold">
                    สิทธิ
                  </th>
                  <th rowSpan={2} colSpan={2} className="border-l border-ink/15 px-2 py-2 text-center font-semibold">
                    IPD ค้างส่งเบิก
                    <div className="text-xs font-medium text-ink/70">ณ {asOfThai}</div>
                  </th>
                  <th colSpan={BUCKETS.length * 2} className="border-l border-ink/15 px-2 py-2 text-center font-semibold">
                    เกินกำหนดเรียกเก็บ IPD
                  </th>
                  <th rowSpan={2} colSpan={2} className="border-l border-ink/15 px-2 py-2 text-center font-semibold">
                    รวมเกินกำหนด
                    <div className="text-xs font-medium text-ink/70">ไม่รวมภายใน 20 วัน</div>
                  </th>
                  <th rowSpan={2} colSpan={2} className="border-l border-ink/15 px-2 py-2 text-center font-semibold">
                    เปอร์เซ็นคงค้าง
                    <div className="text-xs font-medium text-ink/70">รวมเกินกำหนด ÷ ค้างส่งเบิก</div>
                  </th>
                </tr>
                <tr className="bg-brand text-[13px] text-ink">
                  {BUCKETS.map((b) => (
                    <th key={b.key} colSpan={2} className="border-l border-ink/15 px-2 py-2 text-center font-semibold">
                      {b.label}
                    </th>
                  ))}
                </tr>
                <tr className="bg-brand text-[13px] text-ink">
                  <SubHead cols={1 + BUCKETS.length + 1} />
                  <th className="whitespace-nowrap border-l border-ink/15 px-2 py-2 text-right text-xs font-semibold">
                    ตามราย
                  </th>
                  <th className="whitespace-nowrap px-2 py-2 text-right text-xs font-semibold">ตามเงิน</th>
                </tr>
              </thead>
              <tbody>
                {summary.groups.map((g) => (
                  <GroupRow key={g.def.key} g={g} />
                ))}
                <GroupRow g={summary.total} bold />
              </tbody>
            </table>
          </div>

          <ul className="space-y-1 text-sm text-ink/70">
            <li>
              • จำนวนเงิน = ยอดที่รับเอกสาร (ยอด claim จาก HIS) ·{' '}
              {summary.noAmountCount > 0
                ? `มี ${count(summary.noAmountCount)} รายที่ยังไม่มียอด (ยังไม่รับเอกสาร) จึงนับเป็น 0 บาท`
                : 'ทุกรายที่ค้างมียอดครบ'}
            </li>
            <li>
              • ต้นสังกัด PRI = ทุกสิทธิที่ไม่อยู่ในกลุ่มอื่น (เช่น AR003, AR006, EMU4) · ไม่นับสิทธิส่วนลด DIS_*
            </li>
            <li>
              • ไม่นับสิทธิ UNK (เงินสด / ไม่เบิก) ที่ค้างอยู่ {count(summary.excludedCount)} ราย
            </li>
            <li>
              • ไม่นับสิทธิส่วนลด DIS_* ที่ค้างอยู่ {count(summary.excludedDisCount)} ราย
            </li>
            {summary.ungrouped.length > 0 && (
              <li>
                • <span className="font-semibold text-ink">ยังไม่ได้จัดเข้ากลุ่ม (ไม่รวมในผลรวม):</span>{' '}
                {summary.ungrouped.map((u) => `${u.coverage_code} ${count(u.n)} ราย (${money(u.amt)} บาท)`).join(' · ')}
              </li>
            )}
            <li>
              • เคสที่จำหน่ายแล้ว ณ วันที่เลือกทั้งหมด {count(summary.dischargedCount)} ราย (รวมที่ส่งเบิกแล้วและสิทธิที่ไม่นับ)
            </li>
          </ul>
        </>
      )}
    </main>
  )
}
