import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import CoverageMultiSelect from '../components/CoverageMultiSelect'
import CaseDetailModal from '../components/CaseDetailModal'
import { BarChart, ChartCard, EmptyChart, HBarChart, LineChart } from '../components/charts'
import type { Admission, CoverageMaster, PayerMaster } from '../lib/types'
import {
  BASIS_LABELS,
  bucketCounts,
  computeTiming,
  fmt1,
  mean,
  median,
  todayDayNumber,
  type CaseTiming,
  type TimingBasis,
} from '../lib/claimTiming'

const FETCH_CHUNK = 1000
const PAGE_SIZE = 50

// ดึงเฉพาะเคสของสิทธิที่ฉันดูแล (ดึงเป็นช่วงๆ เพราะ PostgREST คืนสูงสุด 1,000 แถว/คำขอ)
async function fetchMyAdmissions(codes: string[]): Promise<Admission[]> {
  const all: Admission[] = []
  for (let from = 0; ; from += FETCH_CHUNK) {
    const { data, error } = await supabase
      .from('admissions')
      .select('*, patients(*), coverage_master(*), payer_master(*), case_tracking(*)')
      .in('coverage_code', codes)
      .not('discharge_date', 'is', null)
      .order('discharge_date', { ascending: false })
      .order('admission_id', { ascending: false })
      .range(from, from + FETCH_CHUNK - 1)
    if (error) throw error
    const chunk = (data as unknown as Admission[]) ?? []
    all.push(...chunk)
    if (chunk.length < FETCH_CHUNK) break
  }
  return all
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })
}

function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('th-TH', { month: 'short', year: '2-digit' })
}

const inputCls =
  'rounded-lg border border-ink/25 bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/60'
const chipCls =
  'rounded-full border border-ink/25 bg-surface px-3 py-1 text-sm text-ink hover:bg-brand transition-colors'

type StatusFilter = '' | 'submitted' | 'pending'
type SortKey = 'days' | 'discharge'

export default function MyJobDashboardPage() {
  const { session } = useAuth()
  const myId = session?.user.id ?? ''

  const [admissions, setAdmissions] = useState<Admission[]>([])
  const [myCoverages, setMyCoverages] = useState<CoverageMaster[]>([])
  const [payers, setPayers] = useState<PayerMaster[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewing, setViewing] = useState<Admission | null>(null)

  // filters
  const [basis, setBasis] = useState<TimingBasis>('discharge')
  const [target, setTarget] = useState(30)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [coverages, setCoverages] = useState<string[]>([])
  const [payer, setPayer] = useState('')
  const [status, setStatus] = useState<StatusFilter>('')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('days')
  const [page, setPage] = useState(1)

  useEffect(() => {
    if (!myId) return
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const asg = await supabase.from('coverage_assignments').select('coverage_code').eq('user_id', myId)
        if (asg.error) throw asg.error
        const codes = (asg.data ?? []).map((r) => r.coverage_code as string)
        if (codes.length === 0) {
          setMyCoverages([])
          setAdmissions([])
          return
        }
        const [cov, pay, rows] = await Promise.all([
          supabase.from('coverage_master').select('*').in('coverage_code', codes).order('coverage_code'),
          supabase.from('payer_master').select('*').order('payer_id'),
          fetchMyAdmissions(codes),
        ])
        if (cov.error) throw cov.error
        if (pay.error) throw pay.error
        setMyCoverages((cov.data as CoverageMaster[]) ?? [])
        setPayers((pay.data as PayerMaster[]) ?? [])
        setAdmissions(rows)
      } catch (e) {
        setError((e as { message?: string })?.message ?? 'โหลดข้อมูลไม่สำเร็จ')
      } finally {
        setLoading(false)
      }
    })()
  }, [myId])

  // รีเซ็ตหน้าตารางเมื่อ filter เปลี่ยน
  useEffect(() => setPage(1), [basis, from, to, coverages, payer, status, search, sortKey])

  const today = useMemo(() => todayDayNumber(), [])

  // เคสหลังกรอง (ยังไม่แยกตามสถานะ เพื่อให้ KPI/กราฟเห็นภาพรวมครบ — ตารางจึงค่อยกรองสถานะทีหลัง)
  const filtered = useMemo(() => {
    return admissions.filter((a) => {
      if (coverages.length > 0 && !coverages.includes(a.coverage_code)) return false
      if (payer && a.payer_id !== payer) return false
      const d = a.discharge_date?.slice(0, 10) ?? ''
      if (from && d < from) return false
      if (to && d > to) return false
      return true
    })
  }, [admissions, coverages, payer, from, to])

  const timings = useMemo(() => filtered.map((a) => computeTiming(a, basis, today)), [filtered, basis, today])

  const stats = useMemo(() => {
    const submittedDays = timings.filter((t) => t.submitted && t.days !== null).map((t) => t.days as number)
    const pending = timings.filter((t) => !t.submitted)
    const pendingDays = pending.filter((t) => t.days !== null).map((t) => t.days as number)
    const withinTarget = submittedDays.filter((d) => d <= target).length
    return {
      total: timings.length,
      submittedCount: timings.filter((t) => t.submitted).length,
      submittedDays,
      pendingCount: pending.length,
      pendingDays,
      avg: mean(submittedDays),
      med: median(submittedDays),
      pctWithin: submittedDays.length ? (withinTarget / submittedDays.length) * 100 : null,
      overdue: pendingDays.filter((d) => d > target).length,
      invalid: timings.filter((t) => t.invalid).length,
    }
  }, [timings, target])

  // แนวโน้มรายเดือน — เคสที่ส่งเบิกแล้ว จัดกลุ่มตามเดือนที่ส่งเบิก
  const trend = useMemo(() => {
    const m = new Map<string, number[]>()
    for (const t of timings) {
      if (!t.submitted || t.days === null) continue
      const sub = t.admission.case_tracking?.submission_date?.slice(0, 7)
      if (!sub) continue
      m.set(sub, [...(m.get(sub) ?? []), t.days])
    }
    return [...m.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([k, v]) => ({ label: monthLabel(k), value: mean(v), count: v.length }))
  }, [timings])

  const byCoverage = useMemo(() => {
    const m = new Map<string, number[]>()
    for (const t of timings) {
      if (!t.submitted || t.days === null) continue
      m.set(t.admission.coverage_code, [...(m.get(t.admission.coverage_code) ?? []), t.days])
    }
    return [...m.entries()]
      .sort(([, a], [, b]) => b.length - a.length)
      .slice(0, 10)
      .map(([code, v]) => ({
        label: code,
        value: mean(v) ?? 0,
        hint: `${code} ${myCoverages.find((c) => c.coverage_code === code)?.coverage_name ?? ''} — เฉลี่ย ${fmt1(mean(v))} วัน (${v.length} เคส)`,
      }))
      .sort((a, b) => b.value - a.value)
  }, [timings, myCoverages])

  const stages = useMemo(() => {
    const pick = (f: (t: CaseTiming) => number | null) => mean(timings.map(f).filter((x): x is number => x !== null))
    return [
      { label: 'จำหน่าย → รับเอกสาร', value: pick((t) => t.stageDischargeDoc) },
      { label: 'รับเอกสาร → Audit', value: pick((t) => t.stageDocAudit) },
      { label: 'Audit → ส่งเบิก', value: pick((t) => t.stageAuditSubmit) },
    ]
  }, [timings])

  // ตาราง
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = timings.filter((t) => {
      if (status === 'submitted' && !t.submitted) return false
      if (status === 'pending' && t.submitted) return false
      if (!q) return true
      const a = t.admission
      return (
        a.hn.toLowerCase().includes(q) ||
        String(a.an).includes(q) ||
        String(a.encounter_id).includes(q) ||
        (a.patients?.full_name ?? '').toLowerCase().includes(q)
      )
    })
    list = [...list].sort((x, y) =>
      sortKey === 'days'
        ? (y.days ?? -1) - (x.days ?? -1)
        : (y.discharge ?? 0) - (x.discharge ?? 0),
    )
    return list
  }, [timings, status, search, sortKey])

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const hasFilter = !!(from || to || coverages.length || payer || status || search)
  function clearFilters() {
    setFrom('')
    setTo('')
    setCoverages([])
    setPayer('')
    setStatus('')
    setSearch('')
  }

  const now = new Date()
  const presets = [
    { label: '30 วันล่าสุด', f: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29), t: now },
    { label: 'เดือนนี้', f: new Date(now.getFullYear(), now.getMonth(), 1), t: new Date(now.getFullYear(), now.getMonth() + 1, 0) },
    { label: 'เดือนที่แล้ว', f: new Date(now.getFullYear(), now.getMonth() - 1, 1), t: new Date(now.getFullYear(), now.getMonth(), 0) },
    { label: 'ปีนี้', f: new Date(now.getFullYear(), 0, 1), t: new Date(now.getFullYear(), 11, 31) },
  ]

  const kpis: { label: string; value: string; note?: string; alert?: boolean }[] = [
    { label: 'เคสทั้งหมด (จำหน่ายแล้ว)', value: stats.total.toLocaleString(), note: `ส่งเบิกแล้ว ${stats.submittedCount.toLocaleString()} · ค้าง ${stats.pendingCount.toLocaleString()}` },
    { label: 'เฉลี่ย (วัน) — ส่งเบิกแล้ว', value: fmt1(stats.avg), note: `มัธยฐาน ${fmt1(stats.med)} วัน` },
    {
      label: `ส่งเบิกทันเป้า ≤ ${target} วัน`,
      value: stats.pctWithin === null ? '—' : `${fmt1(stats.pctWithin)}%`,
      note: `จาก ${stats.submittedDays.length.toLocaleString()} เคสที่วัดได้`,
    },
    {
      label: 'ค้างส่งเบิก',
      value: stats.pendingCount.toLocaleString(),
      note: `เฉลี่ยค้าง ${fmt1(mean(stats.pendingDays))} วัน · เกินเป้า ${stats.overdue.toLocaleString()}`,
      alert: stats.overdue > 0,
    },
  ]

  return (
    <main className="w-full space-y-5 px-4 py-6 sm:px-8">
      <div>
        <h1 className="text-xl font-bold text-ink">My job — Dashboard ระยะเวลาส่งเบิก</h1>
        <p className="mt-1 text-sm text-ink/70">
          คำนวณจากเคสของสิทธิที่คุณดูแล (เลือกสิทธิที่หน้า My claim) เฉพาะเคสที่จำหน่ายแล้ว ·
          เคสที่ยังไม่ส่งเบิกจะนับอายุถึงวันนี้
        </p>
      </div>

      {/* ---------- Filters ---------- */}
      <div className="space-y-3 rounded-xl border border-line bg-paper/50 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-ink/70">
            <div className="mb-1">นับระยะเวลา</div>
            <select value={basis} onChange={(e) => setBasis(e.target.value as TimingBasis)} className={inputCls}>
              {(Object.keys(BASIS_LABELS) as TimingBasis[]).map((k) => (
                <option key={k} value={k}>
                  {BASIS_LABELS[k]}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-ink/70">
            <div className="mb-1">เป้าหมาย (วัน)</div>
            <input
              type="number"
              min={1}
              value={target}
              onChange={(e) => setTarget(Math.max(1, Number(e.target.value) || 1))}
              className={inputCls + ' w-24'}
            />
          </label>

          <div className="text-sm text-ink/70">
            <div className="mb-1">สิทธิ (เฉพาะที่ฉันดูแล)</div>
            <CoverageMultiSelect options={myCoverages} value={coverages} onChange={setCoverages} />
          </div>

          <label className="text-sm text-ink/70">
            <div className="mb-1">ผู้จ่าย</div>
            <select value={payer} onChange={(e) => setPayer(e.target.value)} className={inputCls + ' max-w-[220px]'}>
              <option value="">ทุกผู้จ่าย</option>
              {payers.map((p) => (
                <option key={p.payer_id} value={p.payer_id}>
                  {p.payer_id} — {p.payer_name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-ink/70">
            <div className="mb-1">วันจำหน่าย: เริ่ม</div>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          </label>
          <label className="text-sm text-ink/70">
            <div className="mb-1">สิ้นสุด</div>
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={inputCls} />
          </label>
          <div className="flex flex-wrap gap-1.5 pb-1.5">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                className={chipCls}
                onClick={() => {
                  setFrom(ymd(p.f))
                  setTo(ymd(p.t))
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          {hasFilter && (
            <button type="button" onClick={clearFilters} className="pb-2 text-sm text-ink/70 underline hover:text-ink">
              ล้าง filter
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-rose">{error}</p>}

      {loading ? (
        <div className="rounded-xl border border-line bg-surface p-8 text-center text-sm text-ink/60">กำลังโหลดข้อมูล…</div>
      ) : myCoverages.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface p-8 text-center text-sm text-ink/70">
          คุณยังไม่ได้เลือกสิทธิที่ดูแล — ไปที่ <span className="font-semibold">Menu → My job → My claim</span> เพื่อเลือกสิทธิก่อน
        </div>
      ) : (
        <>
          {/* ---------- KPI ---------- */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {kpis.map((k) => (
              <div
                key={k.label}
                className={
                  'rounded-xl border border-line border-l-8 bg-surface px-5 py-4 ' +
                  (k.alert ? 'border-l-alert' : 'border-l-brand')
                }
              >
                <p className="text-sm font-medium text-ink/70">{k.label}</p>
                <p className="mt-1 text-3xl font-bold tabular-nums text-ink">{k.value}</p>
                {k.note && <p className="mt-0.5 text-sm text-ink/70">{k.note}</p>}
              </div>
            ))}
          </div>
          {stats.invalid > 0 && (
            <p className="text-sm text-ink/60">
              ⚠ มี {stats.invalid} เคสที่วันส่งเบิกมาก่อนจุดเริ่มนับ (ข้อมูลน่าจะคีย์ผิด) — ไม่นับในค่าสถิติ
            </p>
          )}

          {/* ---------- Charts ---------- */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="การกระจายระยะเวลา — เคสที่ส่งเบิกแล้ว" note={`จำนวนเคสแยกตามช่วงวัน (${BASIS_LABELS[basis]})`}>
              {stats.submittedDays.length ? <BarChart data={bucketCounts(stats.submittedDays)} /> : <EmptyChart />}
            </ChartCard>

            <ChartCard title="เคสค้างส่งเบิก — อายุถึงวันนี้" note="ยิ่งอยู่ช่วงขวายิ่งเสี่ยงเกินกำหนด">
              {stats.pendingDays.length ? (
                <BarChart data={bucketCounts(stats.pendingDays)} color="var(--color-alert)" />
              ) : (
                <EmptyChart text="ไม่มีเคสค้าง (หรือยังไม่มีจุดเริ่มนับ)" />
              )}
            </ChartCard>

            <ChartCard title="แนวโน้มรายเดือน" note="ค่าเฉลี่ยวัน แยกตามเดือนที่ส่งเบิก (12 เดือนล่าสุด)">
              {trend.length ? <LineChart data={trend} target={target} /> : <EmptyChart />}
            </ChartCard>

            <ChartCard title="เวลาที่ใช้ในแต่ละขั้นตอน" note="ค่าเฉลี่ย (วัน) เฉพาะเคสที่มีวันครบทั้งสองฝั่งของช่วงนั้น">
              {stages.some((s) => s.value !== null) ? (
                <HBarChart data={stages.map((s) => ({ label: s.label, value: s.value ?? 0 }))} />
              ) : (
                <EmptyChart />
              )}
            </ChartCard>

            <div className="lg:col-span-2">
              <ChartCard title="เฉลี่ยรายสิทธิ" note="10 สิทธิที่มีเคสส่งเบิกมากที่สุด (วางเมาส์เพื่อดูชื่อสิทธิและจำนวนเคส)">
                {byCoverage.length ? <HBarChart data={byCoverage} /> : <EmptyChart />}
              </ChartCard>
            </div>
          </div>

          {/* ---------- Per-case table ---------- */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-[15px] font-semibold text-ink">รายเคส ({rows.length.toLocaleString()})</h2>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ค้นหา HN, AN, ชื่อ, encounter_id…"
                  className={inputCls + ' w-64 placeholder:text-ink/40'}
                />
                <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className={inputCls}>
                  <option value="">ทุกสถานะ</option>
                  <option value="submitted">ส่งเบิกแล้ว</option>
                  <option value="pending">ค้างส่งเบิก</option>
                </select>
                <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className={inputCls}>
                  <option value="days">เรียงตามจำนวนวัน (มาก → น้อย)</option>
                  <option value="discharge">เรียงตามวันจำหน่าย (ใหม่ → เก่า)</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead>
                  <tr className="bg-brand text-[13px] text-ink">
                    <th className="px-3 py-3 font-semibold">HN / ชื่อ</th>
                    <th className="px-3 py-3 font-semibold">สิทธิ</th>
                    <th className="px-3 py-3 font-semibold">จำหน่าย</th>
                    <th className="px-3 py-3 font-semibold">รับเอกสาร</th>
                    <th className="px-3 py-3 font-semibold">Audit</th>
                    <th className="px-3 py-3 font-semibold">ส่งเบิก</th>
                    <th className="px-3 py-3 text-right font-semibold">วัน ({BASIS_LABELS[basis]})</th>
                    <th className="px-3 py-3 font-semibold">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((t) => {
                    const a = t.admission
                    const ct = a.case_tracking
                    const over = t.days !== null && t.days > target
                    return (
                      <tr
                        key={a.admission_id}
                        onClick={() => setViewing(a)}
                        className="cursor-pointer border-b border-line last:border-0 hover:bg-paper"
                      >
                        <td className="px-3 py-2.5">
                          <div className="font-mono text-[13px] font-semibold">{a.hn}</div>
                          <div className="text-ink/70">{a.patients?.full_name ?? '—'}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="mr-1.5 font-mono text-[13px] font-semibold">{a.coverage_code}</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5">{fmtDate(a.discharge_date)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5">{fmtDate(ct?.document_received_date ?? null)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5">{fmtDate(ct?.audit_date ?? null)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5">{fmtDate(ct?.submission_date ?? null)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {t.days === null ? (
                            <span className="text-ink/40">{t.invalid ? 'ผิดปกติ' : '—'}</span>
                          ) : (
                            <span
                              className={
                                'inline-block min-w-8 rounded-full px-2.5 py-0.5 text-center font-bold ' +
                                (over ? 'bg-alert text-white' : t.submitted ? 'bg-brand text-ink' : 'bg-brand-soft text-ink')
                              }
                            >
                              {t.days}
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-ink/80">
                          {t.submitted ? 'ส่งเบิกแล้ว' : 'ค้างส่งเบิก'}
                        </td>
                      </tr>
                    )
                  })}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-sm text-ink/60">
                        ไม่พบเคสตามเงื่อนไขที่เลือก
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {pageCount > 1 && (
              <div className="flex items-center justify-end gap-2 text-sm">
                <button disabled={page <= 1} onClick={() => setPage(page - 1)} className={chipCls + ' disabled:opacity-40'}>
                  ก่อนหน้า
                </button>
                <span className="text-ink/70">
                  {page} / {pageCount}
                </span>
                <button
                  disabled={page >= pageCount}
                  onClick={() => setPage(page + 1)}
                  className={chipCls + ' disabled:opacity-40'}
                >
                  ถัดไป
                </button>
              </div>
            )}
          </section>
        </>
      )}

      {viewing && <CaseDetailModal admission={viewing} onClose={() => setViewing(null)} />}
    </main>
  )
}
