import type { ReactNode } from 'react'

// กราฟ SVG เบาๆ ไม่พึ่งไลบรารีเพิ่ม — สีตามธีม เหลือง/ขาว/ดำ

export function ChartCard({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {note && <p className="mt-0.5 text-sm text-ink/60">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

export function EmptyChart({ text = 'ยังไม่มีข้อมูลในช่วงที่เลือก' }: { text?: string }) {
  return <p className="py-10 text-center text-sm text-ink/50">{text}</p>
}

export interface BarDatum {
  label: string
  value: number
  /** ข้อความใน tooltip (ไม่ใส่ = label: value) */
  hint?: string
}

/** แท่งแนวตั้ง — ใช้กับ histogram */
export function BarChart({
  data,
  color = 'var(--color-brand)',
  unit = '',
  height = 200,
}: {
  data: BarDatum[]
  color?: string
  unit?: string
  height?: number
}) {
  const W = 480
  const padL = 30
  const padB = 28
  const padT = 18
  const max = Math.max(1, ...data.map((d) => d.value))
  const innerW = W - padL - 8
  const innerH = height - padB - padT
  const slot = innerW / data.length
  const bw = Math.min(56, slot * 0.62)

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img">
      {[0, 0.5, 1].map((t) => {
        const y = padT + innerH * (1 - t)
        return (
          <g key={t}>
            <line x1={padL} x2={W - 8} y1={y} y2={y} stroke="var(--color-line)" />
            <text x={padL - 4} y={y + 4} textAnchor="end" fontSize="10" fill="#666">
              {Math.round(max * t)}
            </text>
          </g>
        )
      })}
      {data.map((d, i) => {
        const h = (d.value / max) * innerH
        const x = padL + slot * i + (slot - bw) / 2
        const y = padT + innerH - h
        return (
          <g key={d.label}>
            <title>{d.hint ?? `${d.label}: ${d.value}${unit}`}</title>
            <rect x={x} y={y} width={bw} height={Math.max(h, d.value > 0 ? 1 : 0)} rx="3" fill={color} />
            <text x={x + bw / 2} y={y - 4} textAnchor="middle" fontSize="11" fontWeight="600" fill="#111">
              {d.value > 0 ? d.value : ''}
            </text>
            <text x={x + bw / 2} y={height - 10} textAnchor="middle" fontSize="11" fill="#444">
              {d.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** แท่งแนวนอน — ใช้เปรียบเทียบรายสิทธิ / รายช่วง */
export function HBarChart({
  data,
  color = 'var(--color-brand)',
  unit = ' วัน',
  maxValue,
  decimals = 1,
}: {
  data: BarDatum[]
  color?: string
  unit?: string
  /** กำหนดเพดานแกนเอง (ไม่ใส่ = ค่ามากสุดในข้อมูล) */
  maxValue?: number
  decimals?: number
}) {
  const rowH = 30
  const W = 480
  const labelW = 150
  const valueW = 64
  const H = data.length * rowH + 4
  const max = Math.max(1, maxValue ?? 0, ...data.map((d) => d.value))
  const barMax = W - labelW - valueW

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      {data.map((d, i) => {
        const y = i * rowH + 2
        const w = (d.value / max) * barMax
        const shown = decimals === 0 ? String(Math.round(d.value)) : (Math.round(d.value * 10) / 10).toLocaleString('th-TH')
        return (
          <g key={d.label}>
            <title>{d.hint ?? `${d.label}: ${shown}${unit}`}</title>
            <text x={labelW - 8} y={y + rowH / 2 + 4} textAnchor="end" fontSize="12" fill="#111">
              {d.label.length > 20 ? d.label.slice(0, 19) + '…' : d.label}
            </text>
            <rect x={labelW} y={y + 4} width={Math.max(w, d.value > 0 ? 2 : 0)} height={rowH - 10} rx="3" fill={color} />
            <text x={labelW + w + 6} y={y + rowH / 2 + 4} fontSize="12" fontWeight="600" fill="#111">
              {shown}
              {unit === ' วัน' ? '' : unit}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export interface LinePoint {
  label: string
  value: number | null
  count?: number
}

/** เส้นแนวโน้มรายเดือน (ค่าเฉลี่ยวัน) + เส้นเป้าหมายประกอบ */
export function LineChart({
  data,
  target,
  height = 220,
}: {
  data: LinePoint[]
  target?: number
  height?: number
}) {
  const W = 480
  const padL = 36
  const padR = 12
  const padT = 16
  const padB = 30
  const vals = data.map((d) => d.value).filter((v): v is number => v !== null)
  const max = Math.max(1, target ?? 0, ...vals) * 1.1
  const innerW = W - padL - padR
  const innerH = height - padT - padB
  const xAt = (i: number) => padL + (data.length === 1 ? innerW / 2 : (innerW * i) / (data.length - 1))
  const yAt = (v: number) => padT + innerH * (1 - v / max)

  const segs: string[] = []
  let cur = ''
  data.forEach((d, i) => {
    if (d.value === null) {
      if (cur) segs.push(cur)
      cur = ''
    } else {
      cur += `${cur ? 'L' : 'M'}${xAt(i)},${yAt(d.value)}`
    }
  })
  if (cur) segs.push(cur)

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img">
      {[0, 0.5, 1].map((t) => {
        const y = padT + innerH * (1 - t)
        return (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="var(--color-line)" />
            <text x={padL - 4} y={y + 4} textAnchor="end" fontSize="10" fill="#666">
              {Math.round(max * t)}
            </text>
          </g>
        )
      })}
      {target !== undefined && target <= max && (
        <g>
          <line x1={padL} x2={W - padR} y1={yAt(target)} y2={yAt(target)} stroke="var(--color-alert)" strokeDasharray="5 4" />
          <text x={W - padR} y={yAt(target) - 4} textAnchor="end" fontSize="10" fill="var(--color-alert)">
            เป้าหมาย {target} วัน
          </text>
        </g>
      )}
      {segs.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="#111" strokeWidth="2" />
      ))}
      {data.map((d, i) => (
        <g key={d.label}>
          {d.value !== null && (
            <>
              <title>{`${d.label}: เฉลี่ย ${Math.round(d.value * 10) / 10} วัน${d.count !== undefined ? ` (${d.count} เคส)` : ''}`}</title>
              <circle cx={xAt(i)} cy={yAt(d.value)} r="5" fill="var(--color-brand)" stroke="#111" strokeWidth="1.5" />
              <text x={xAt(i)} y={yAt(d.value) - 9} textAnchor="middle" fontSize="11" fontWeight="600" fill="#111">
                {Math.round(d.value * 10) / 10}
              </text>
            </>
          )}
          <text x={xAt(i)} y={height - 10} textAnchor="middle" fontSize="11" fill="#444">
            {d.label}
          </text>
        </g>
      ))}
    </svg>
  )
}
