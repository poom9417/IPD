import { useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react'
import type { AmountStats } from '../lib/repDashboard'

/**
 * กราฟยอดเงิน REP (มินิมอล) — เทียบ "ยอดตั้งเบิก" กับ "ยอดที่ได้รับ (REP)" ตามตัวกรองบนหน้าจอ
 *  - % ได้รับ / ส่วนต่าง คิดจากเคสที่ "ผ่าน" และมียอดครบทั้งสองฝั่งเท่านั้น (เคสติด C ยังไม่มียอดจ่ายจริง)
 *  - แนวทาง: marks บาง · เว้นช่อง 2px แทนเส้นขอบ · ตัวหนังสือใช้สี ink ไม่ใช้สีข้อมูล · ชี้/โฟกัสเพื่อดูรายละเอียด · มีตารางสำรอง
 */

const money = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pctOf = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0)
const pct1 = (n: number) => `${n.toFixed(1)}%`

/** สีกราฟ — ธีมสว่างเท่านั้น (ตามธีมเว็บ) · สถานะใช้พาเลต status ที่กำหนดไว้ */
const C = {
  good: '#0ca30c',
  warning: '#fab219',
  critical: '#d03b3b',
  other: '#c3c2b7',
  ink: '#111111',
  track: '#ecebe4',
}
/** สีตัวหนังสือบนแถบสี: ขาว ยกเว้นบนเหลือง/เทาอ่อน */
const onFill = (bg: string) => (bg === C.warning || bg === C.other ? '#0b0b0b' : '#ffffff')

/* ───────────── tooltip (ชี้เมาส์ หรือโฟกัสคีย์บอร์ด) ───────────── */

interface TipData {
  title: string
  value: string
  sub?: string
  color?: string
}

function useTip() {
  const ref = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<{ x: number; y: number; d: TipData } | null>(null)

  const show = (cx: number, cy: number, d: TipData) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const x = Math.min(Math.max(cx - r.left, 96), Math.max(r.width - 96, 96))
    setTip({ x, y: cy - r.top, d })
  }
  const hide = () => setTip(null)
  const bind = (d: TipData) => ({
    onPointerMove: (e: PointerEvent) => show(e.clientX, e.clientY, d),
    onPointerLeave: hide,
    onFocus: (e: FocusEvent<HTMLElement>) => {
      const b = e.currentTarget.getBoundingClientRect()
      show(b.left + b.width / 2, b.top, d)
    },
    onBlur: hide,
  })

  const node = tip && (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 min-w-[10rem] rounded-lg border border-line bg-surface px-3 py-2 shadow-md"
      style={{ left: tip.x, top: tip.y - 10, transform: 'translate(-50%, -100%)' }}
    >
      <div className="text-sm font-semibold tabular-nums text-ink">{tip.d.value}</div>
      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink/70">
        {tip.d.color && <span className="inline-block h-[2px] w-3 shrink-0" style={{ background: tip.d.color }} />}
        <span>{tip.d.title}</span>
      </div>
      {tip.d.sub && <div className="mt-0.5 text-xs text-ink/50">{tip.d.sub}</div>}
    </div>
  )
  return { ref, bind, node }
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/* ───────────── ส่วนประกอบ ───────────── */

function Card({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {note && <p className="mt-0.5 text-xs text-ink/60">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="py-8 text-center text-sm text-ink/50">{text}</p>
}

/** แผ่นตัวเลขสรุป — ป้ายเล็ก ตัวเลขใหญ่ (ตัวเลขแบบ proportional ไม่ใช้ tabular) */
function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-rose' : 'text-ink'
  return (
    <div className="px-5 py-4">
      <div className="text-xs text-ink/60">{label}</div>
      <div className={'mt-1 text-2xl font-semibold leading-tight ' + color}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink/50">{sub}</div>}
    </div>
  )
}

interface Seg {
  key: string
  label: string
  value: number
  color: string
}

/** แถบแบ่งส่วน (สูง 28px) — แต่ละส่วนพิมพ์ % ในบล็อกเมื่อพอดี · เว้น 2px · ชื่อ+ยอดอยู่ที่คำอธิบาย */
function SegmentedBar({ segs, total }: { segs: Seg[]; total: number }) {
  const [wrap, width] = useWidth<HTMLDivElement>()
  const { ref, bind, node } = useTip()
  const gaps = Math.max(0, segs.length - 1) * 2
  const usable = Math.max(0, width - gaps)

  return (
    <div ref={ref} className="relative">
      {node}
      <div ref={wrap} className="flex h-7 gap-[2px]" role="img" aria-label={segs.map((s) => `${s.label} ${pct1(pctOf(s.value, total))}`).join(', ')}>
        {segs.map((s) => {
          const share = pctOf(s.value, total)
          const label = pct1(share)
          // พิมพ์ตัวเลขในบล็อกเมื่อกว้างพอ (ประมาณความกว้างตัวหนังสือ + ช่องไฟ 16px)
          const fits = usable * (s.value / total) >= label.length * 7.5 + 16
          return (
            <div
              key={s.key}
              tabIndex={0}
              aria-label={`${s.label}: ${money(s.value)} (${label})`}
              className="flex min-w-0 items-center overflow-visible rounded-[4px] px-2 text-xs font-semibold outline-none transition-[filter] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ink"
              style={{ flexGrow: s.value, flexBasis: 0, background: s.color, color: onFill(s.color) }}
              {...bind({ title: s.label, value: money(s.value), sub: `${label} ของยอดตั้งเบิก`, color: s.color })}
            >
              {fits ? label : null}
            </div>
          )
        })}
      </div>
      <ul className="mt-4 space-y-1.5 text-sm">
        {segs.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: s.color }} />
            <span className="flex-1 text-ink">{s.label}</span>
            <span className="tabular-nums text-ink/70">{money(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

interface MeterRow {
  key: string
  name: string
  detail?: string
  value: number
  max: number
  figure: string
  tip: TipData
}

/** รายการมิเตอร์ — ชื่อ · แถบ · ตัวเลข ต่อแถว แถบเรียงตรงกัน (จอแคบ แถบลงไปอยู่ใต้ชื่อ) */
function MeterList({ rows }: { rows: MeterRow[] }) {
  const { ref, bind, node } = useTip()
  return (
    <div ref={ref} className="relative">
      {node}
      <ul>
        {rows.map((r) => {
          const w = r.max > 0 ? Math.min(100, (r.value / r.max) * 100) : 0
          return (
            <li
              key={r.key}
              tabIndex={0}
              aria-label={`${r.name}: ${r.figure}`}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 rounded-lg px-2 py-2 outline-none hover:bg-ink/[0.03] focus-visible:ring-2 focus-visible:ring-ink sm:grid-cols-[11rem_minmax(0,1fr)_3.75rem]"
              {...bind(r.tip)}
            >
              <div className="order-1 min-w-0">
                <div className="truncate text-sm text-ink">{r.name}</div>
                {r.detail && <div className="truncate text-xs text-ink/50">{r.detail}</div>}
              </div>
              <div className="order-3 col-span-2 h-2.5 rounded-[4px] sm:order-2 sm:col-span-1" style={{ background: C.track }}>
                <div className="h-full rounded-r-[4px]" style={{ width: `${w}%`, minWidth: r.value > 0 ? 2 : 0, background: C.ink }} />
              </div>
              <div className="order-2 text-right text-sm font-semibold tabular-nums text-ink sm:order-3">{r.figure}</div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ───────────── ส่วนหลัก ───────────── */

export default function RepAmountCharts({ stats }: { stats: AmountStats }) {
  const s = stats

  if (s.claimedTotal === 0) {
    return (
      <section className="rounded-xl border border-line bg-surface p-5">
        <Empty text="ยังไม่มียอดตั้งเบิกในเคสที่เลือก" />
      </section>
    )
  }

  const segs: Seg[] = [
    { key: 'received', label: 'ได้รับแล้ว', value: s.received, color: C.good },
    { key: 'cut', label: 'ถูกตัด / จ่ายน้อยกว่าตั้งเบิก', value: s.cut, color: C.warning },
    { key: 'c', label: 'ติด C (ยังไม่ได้รับ)', value: s.inC, color: C.critical },
    { key: 'other', label: 'อื่น ๆ / ยังไม่มียอด REP', value: s.other, color: C.other },
  ].filter((x) => x.value > 0)

  const pctReceived = pctOf(s.paidCompared, s.claimedCompared)
  const hasCompared = s.comparedCases > 0
  const diffTone = s.diffNet > 0 ? 'good' : s.diffNet < 0 ? 'bad' : undefined
  const diffIcon = s.diffNet > 0 ? '▲ ' : s.diffNet < 0 ? '▼ ' : ''

  const diffRows: MeterRow[] = [
    { key: 'less', name: 'จ่ายน้อยกว่าตั้งเบิก', n: s.less },
    { key: 'equal', name: 'จ่ายเท่ากัน', n: s.equal },
    { key: 'more', name: 'จ่ายมากกว่าตั้งเบิก', n: s.more },
  ].map((d) => ({
    key: d.key,
    name: d.name,
    value: d.n,
    max: s.comparedCases,
    figure: `${d.n} เคส`,
    tip: { title: d.name, value: `${d.n} เคส`, sub: `${pct1(pctOf(d.n, s.comparedCases))} ของเคสที่เทียบได้` },
  }))

  const covRows: MeterRow[] = s.byCoverage.map((c) => ({
    key: c.label,
    name: c.label,
    detail: `${money(c.paid)} จาก ${money(c.claimed)}`,
    value: c.pct,
    max: 100,
    figure: pct1(c.pct),
    tip: { title: c.label, value: pct1(c.pct), sub: `ได้รับ ${money(c.paid)} จากตั้งเบิก ${money(c.claimed)} · ${c.cases} เคส` },
  }))

  return (
    <section className="space-y-4">
      {/* ตัวเลขสรุป */}
      <div className="grid divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        <Tile label="ยอดตั้งเบิกรวม" value={money(s.claimedTotal)} sub={s.noClaimed > 0 ? `ไม่นับ ${s.noClaimed} เคสที่ไม่มียอดตั้งเบิก` : 'ทุกเคสตามตัวกรอง'} />
        <Tile label="ยอดที่ได้รับ (REP)" value={hasCompared ? money(s.paidCompared) : '–'} sub={hasCompared ? `เคสที่ผ่าน ${s.comparedCases} เคส` : 'ยังไม่มีเคสที่เทียบได้'} />
        <Tile label="ได้รับ ÷ ตั้งเบิก" value={hasCompared ? pct1(pctReceived) : '–'} sub="เฉพาะเคสที่ผ่าน" />
        <Tile label="ส่วนต่างสุทธิ" value={hasCompared ? `${diffIcon}${money(Math.abs(s.diffNet))}` : '–'} sub="ยอดที่จ่าย − ยอดตั้งเบิก" tone={hasCompared ? diffTone : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="สัดส่วนยอดตั้งเบิก" note="ยอดตั้งเบิกทั้งหมดแบ่งตามผลที่ได้รับกลับมา">
          <SegmentedBar segs={segs} total={s.claimedTotal} />
          {s.overpaid > 0 && <p className="mt-3 text-xs text-good">มีเคสที่จ่ายมากกว่าตั้งเบิก รวม +{money(s.overpaid)} (ไม่รวมในแถบ)</p>}
        </Card>

        <Card title="จำนวนเคสตามส่วนต่าง" note="เฉพาะเคสที่ผ่านและมียอดครบ">
          {hasCompared ? <MeterList rows={diffRows} /> : <Empty text="ยังไม่มีเคสที่เทียบยอดได้" />}
        </Card>
      </div>

      <Card title="% ที่ได้รับ แยกตามสิทธิ / ผู้จ่าย" note="ยอดที่ได้รับ ÷ ยอดตั้งเบิก ของเคสที่ผ่าน · เรียงตามยอดตั้งเบิกมากไปน้อย">
        {covRows.length > 0 ? <MeterList rows={covRows} /> : <Empty text="ยังไม่มีเคสที่เทียบยอดได้" />}
      </Card>

      {/* ตารางสำรอง — ค่าทุกตัวในกราฟอ่านได้โดยไม่ต้องชี้เมาส์ */}
      <details className="rounded-xl border border-line bg-surface px-5 py-3 text-sm">
        <summary className="cursor-pointer select-none text-ink/70">ดูข้อมูลกราฟเป็นตาราง</summary>
        <div className="mt-3 grid gap-6 overflow-x-auto lg:grid-cols-2">
          <table className="w-full min-w-[320px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-xs text-ink/60">
                <th className="py-1.5 font-medium">ส่วนของยอดตั้งเบิก</th>
                <th className="py-1.5 text-right font-medium">ยอด</th>
                <th className="py-1.5 text-right font-medium">สัดส่วน</th>
              </tr>
            </thead>
            <tbody>
              {segs.map((g) => (
                <tr key={g.key} className="border-b border-line/60">
                  <td className="py-1.5">{g.label}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(g.value)}</td>
                  <td className="py-1.5 text-right tabular-nums">{pct1(pctOf(g.value, s.claimedTotal))}</td>
                </tr>
              ))}
              <tr>
                <td className="py-1.5 font-semibold">รวมยอดตั้งเบิก</td>
                <td className="py-1.5 text-right font-semibold tabular-nums">{money(s.claimedTotal)}</td>
                <td className="py-1.5 text-right tabular-nums">100.0%</td>
              </tr>
            </tbody>
          </table>
          <table className="w-full min-w-[420px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-xs text-ink/60">
                <th className="py-1.5 font-medium">สิทธิ / ผู้จ่าย</th>
                <th className="py-1.5 text-right font-medium">เคส</th>
                <th className="py-1.5 text-right font-medium">ตั้งเบิก</th>
                <th className="py-1.5 text-right font-medium">ได้รับ</th>
                <th className="py-1.5 text-right font-medium">%</th>
              </tr>
            </thead>
            <tbody>
              {s.byCoverage.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-center text-ink/50">
                    ยังไม่มีเคสที่เทียบยอดได้
                  </td>
                </tr>
              )}
              {s.byCoverage.map((c) => (
                <tr key={c.label} className="border-b border-line/60">
                  <td className="py-1.5">{c.label}</td>
                  <td className="py-1.5 text-right tabular-nums">{c.cases}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(c.claimed)}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(c.paid)}</td>
                  <td className="py-1.5 text-right tabular-nums">{pct1(c.pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink/50">
          เคสตามส่วนต่าง: จ่ายน้อยกว่า {s.less} · เท่ากัน {s.equal} · มากกว่า {s.more} (เฉพาะเคสที่ผ่านและมียอดครบ)
        </p>
      </details>
    </section>
  )
}
