import { BarChart, ChartCard, EmptyChart, HBarChart } from './charts'
import type { AmountStats } from '../lib/repDashboard'

/**
 * กราฟยอดเงิน REP — เทียบ "ยอดตั้งเบิก" กับ "ยอดที่ได้รับ (REP)" ตามตัวกรองบนหน้าจอ
 *  - % ได้รับ / ส่วนต่าง คิดจากเคสที่ "ผ่าน" และมียอดครบทั้งสองฝั่งเท่านั้น (เคสติด C ยังไม่มียอดจ่ายจริง)
 */

const money = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pctOf = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0)

export default function RepAmountCharts({ stats }: { stats: AmountStats }) {
  const s = stats
  if (s.claimedTotal === 0) {
    return (
      <ChartCard title="ภาพรวมยอดเงิน">
        <EmptyChart text="ยังไม่มียอดตั้งเบิกในเคสที่เลือก" />
      </ChartCard>
    )
  }

  const segs = [
    { label: 'ได้รับแล้ว', value: s.received, color: 'var(--color-good)' },
    { label: 'ถูกตัด/จ่ายน้อยกว่าตั้งเบิก', value: s.cut, color: 'var(--color-brand)' },
    { label: 'ติด C (ยังไม่ได้รับ)', value: s.inC, color: 'var(--color-rose)' },
    { label: 'อื่น ๆ / ยังไม่มียอด REP', value: s.other, color: '#9ca3af' },
  ].filter((x) => x.value > 0)

  const pctReceived = pctOf(s.paidCompared, s.claimedCompared)

  return (
    <section className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="ยอดตั้งเบิกรวม" value={money(s.claimedTotal)} sub={s.noClaimed > 0 ? `ไม่นับ ${s.noClaimed} เคสที่ไม่มียอดตั้งเบิก` : 'ทุกเคสตามตัวกรอง'} />
        <Kpi label="ยอดที่ได้รับ (REP) — เคสที่ผ่าน" value={money(s.paidCompared)} sub={`${s.comparedCases} เคสที่เทียบได้`} />
        <Kpi label="ได้รับ / ตั้งเบิก" value={s.comparedCases ? `${pctReceived.toFixed(1)}%` : '–'} sub="เฉพาะเคสที่ผ่าน" />
        <Kpi
          label="ส่วนต่างสุทธิ"
          value={s.comparedCases ? `${s.diffNet > 0 ? '+' : ''}${money(s.diffNet)}` : '–'}
          sub="ยอดที่จ่าย − ยอดตั้งเบิก"
          tone={s.diffNet > 0 ? 'good' : s.diffNet < 0 ? 'bad' : undefined}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="สัดส่วนยอดตั้งเบิก" note="ยอดตั้งเบิกทั้งหมดแบ่งตามผลที่ได้รับกลับมา">
          <div className="flex h-7 w-full overflow-hidden rounded-md border border-ink/20">
            {segs.map((g) => (
              <div key={g.label} style={{ width: `${pctOf(g.value, s.claimedTotal)}%`, background: g.color }} title={`${g.label}: ${money(g.value)}`} />
            ))}
          </div>
          <ul className="mt-3 space-y-1.5 text-sm">
            {segs.map((g) => (
              <li key={g.label} className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: g.color }} />
                <span className="flex-1 text-ink">{g.label}</span>
                <span className="tabular-nums text-ink/70">{money(g.value)}</span>
                <span className="w-14 text-right font-semibold tabular-nums text-ink">{pctOf(g.value, s.claimedTotal).toFixed(1)}%</span>
              </li>
            ))}
          </ul>
          {s.overpaid > 0 && <p className="mt-2 text-xs text-good">มีเคสที่จ่ายมากกว่าตั้งเบิก รวม +{money(s.overpaid)} (ไม่รวมในแถบด้านบน)</p>}
        </ChartCard>

        <ChartCard title="จำนวนเคสตามส่วนต่าง" note="เฉพาะเคสที่ผ่านและมียอดครบ">
          {s.comparedCases === 0 ? (
            <EmptyChart text="ยังไม่มีเคสที่เทียบยอดได้" />
          ) : (
            <BarChart
              height={190}
              unit=" เคส"
              data={[
                { label: 'จ่ายน้อยกว่า', value: s.less },
                { label: 'เท่ากัน', value: s.equal },
                { label: 'จ่ายมากกว่า', value: s.more },
              ]}
            />
          )}
        </ChartCard>
      </div>

      <ChartCard title="% ที่ได้รับ แยกตามสิทธิ / ผู้จ่าย" note="ยอดที่ได้รับ ÷ ยอดตั้งเบิก ของเคสที่ผ่าน (เรียงตามยอดตั้งเบิกมากไปน้อย)">
        {s.byCoverage.length === 0 ? (
          <EmptyChart text="ยังไม่มีเคสที่เทียบยอดได้" />
        ) : (
          <HBarChart
            unit="%"
            decimals={1}
            maxValue={100}
            color="var(--color-good)"
            data={s.byCoverage.map((c) => ({
              label: c.label,
              value: c.pct,
              hint: `${c.label}: ได้รับ ${money(c.paid)} จากตั้งเบิก ${money(c.claimed)} (${c.cases} เคส)`,
            }))}
          />
        )}
      </ChartCard>
    </section>
  )
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="text-xs text-ink/70">{label}</div>
      <div className={'mt-1 text-xl font-bold tabular-nums ' + (tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-rose' : 'text-ink')}>{value}</div>
      {sub && <div className="text-xs text-ink/60">{sub}</div>}
    </div>
  )
}
