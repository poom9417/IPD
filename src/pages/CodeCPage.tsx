import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Button from '../components/ui/Button'
import { useAuth } from '../contexts/AuthContext'
import { loadCCases, STATUS_LABEL, type CCase, type CCode, type CStatus } from '../lib/codeC'
import { loadMaster, saveFix, type MasterCode } from '../lib/repStore'

/**
 * Code C (ใหม่) — หน้าไว้ดูเคสที่ติด C แบบเรียลไทม์จากข้อมูลของเรา (ผลตอบกลับ REP ที่บันทึกไว้ + เลขตั้งเบิกปัจจุบัน)
 * เน้นรหัส error ที่มาก่อน 837 เพราะเป็นรหัสที่ผู้ใช้นำไปแก้จริง · 837 / 83A / 926 เป็นคำเตือนที่ไม่ต้องแก้ จึงแสดงแค่จำนวน
 * วิธีแก้เก็บเป็น master C (รายรหัส) ไม่ต้องกรอกซ้ำทุกครั้งที่อัปโหลดไฟล์
 */

const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '–')
const th = 'whitespace-nowrap px-2 py-2 text-xs font-semibold'
const td = 'px-2 py-2 align-top'

const STATUS_CLS: Record<CStatus, string> = {
  open: 'border-rose/40 bg-rose-soft text-rose',
  resent: 'border-ink/30 bg-brand-soft text-ink',
  passed: 'border-line bg-surface text-ink/70',
  other: 'border-line bg-surface text-ink/70',
}

type Tab = 'cases' | 'master'
type StatusFilter = 'active' | 'all' | CStatus

export default function CodeCPage() {
  const { role, roleLoading } = useAuth()
  const allowed = role === 'admin' || role === 'user'
  const [tab, setTab] = useState<Tab>('cases')
  const [cases, setCases] = useState<CCase[]>([])
  const [master, setMaster] = useState<MasterCode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [c, m] = await Promise.all([loadCCases(), loadMaster()])
      setCases(c)
      setMaster(m)
      setError(null)
      setLoadedAt(new Date())
    } catch (e) {
      setError(`โหลดข้อมูล Code C ไม่สำเร็จ: ${(e as { message?: string })?.message ?? String(e)}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (allowed) void reload()
  }, [allowed, reload])

  // เรียลไทม์: โหลดใหม่ทุก 60 วินาทีขณะเปิดหน้านี้ และเมื่อกลับมาที่แท็บ
  useEffect(() => {
    if (!allowed) return
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reload()
    }, 60000)
    const onVis = () => document.visibilityState === 'visible' && void reload()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [allowed, reload])

  if (roleLoading || role === null) return <main className="px-4 py-6 text-sm text-ink/70 sm:px-8">กำลังโหลด…</main>
  if (!allowed) {
    return (
      <main className="w-full px-4 py-6 sm:px-8">
        <div className="rounded-xl border border-line bg-surface p-4 text-sm text-ink">
          หน้า Code C ใหม่แสดงข้อมูลผลตอบกลับ REP (ชื่อผู้ป่วยและยอดเงิน) จึงเปิดให้ admin / user / developer เท่านั้น
        </div>
      </main>
    )
  }

  const tabCls = (t: Tab) =>
    'rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ' +
    (tab === t ? 'border-ink bg-brand text-ink' : 'border-ink/30 text-ink hover:bg-brand-soft')

  return (
    <main className="w-full space-y-4 px-4 py-6 sm:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Code C — เคสที่ติด C จากผลตอบกลับ REP</h1>
          <p className="mt-1 text-sm text-ink/70">
            ข้อมูลมาจาก REP ที่บันทึกไว้ที่หน้า "ตั้งหนี้ SAP" · สถานะคำนวณสดจากเลขตั้งเบิกปัจจุบันของเคส · เน้นรหัสที่มาก่อน 837 (รหัสที่ต้องแก้)
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-ink/60">
          {loadedAt && <span>อัปเดตล่าสุด {loadedAt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
          <Button type="button" variant="outline" onClick={() => void reload()} disabled={loading}>
            {loading ? 'กำลังโหลด…' : 'รีเฟรช'}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={tabCls('cases')} onClick={() => setTab('cases')}>
          เคสติด C
        </button>
        <button type="button" className={tabCls('master')} onClick={() => setTab('master')}>
          Master C (รหัส + วิธีแก้)
        </button>
      </div>

      {error && <div className="rounded-lg border border-rose/30 bg-rose-soft/50 px-4 py-2 text-sm text-rose">{error}</div>}

      {tab === 'cases' ? <CasesTab cases={cases} master={master} loading={loading} /> : <MasterTab master={master} cases={cases} onSaved={() => void reload()} />}
    </main>
  )
}

/* ───────────── เคสติด C ───────────── */

function CasesTab({ cases, master, loading }: { cases: CCase[]; master: MasterCode[]; loading: boolean }) {
  const [status, setStatus] = useState<StatusFilter>('active')
  const [code, setCode] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<CCase | null>(null)

  const masterOf = useMemo(() => {
    const m = new Map<string, MasterCode>()
    for (const r of master) m.set(`${r.payer_id}|${r.code}`, r)
    return m
  }, [master])
  const fixOf = (c: CCase, k: CCode) => masterOf.get(`${c.payerId}|${k.code}`)?.our_fix ?? null

  const count = (s: CStatus) => cases.filter((c) => c.status === s).length
  const allCodes = useMemo(() => [...new Set(cases.flatMap((c) => c.lastC.errors.map((e) => e.code)))].sort(), [cases])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return cases
      .filter((c) => (status === 'all' ? true : status === 'active' ? c.status === 'open' || c.status === 'resent' : c.status === status))
      .filter((c) => !code || c.lastC.errors.some((e) => e.code === code))
      .filter(
        (c) =>
          !needle ||
          String(c.encounterId).includes(needle) ||
          (c.name ?? '').toLowerCase().includes(needle) ||
          (c.hn ?? '').toLowerCase().includes(needle) ||
          (c.currentClaimNo ?? '').toLowerCase().includes(needle) ||
          c.lastC.errors.some((e) => (e.detail ?? '').toLowerCase().includes(needle)),
      )
      .sort((a, b) => {
        const rank = (s: CStatus) => (s === 'open' ? 0 : s === 'resent' ? 1 : s === 'other' ? 2 : 3)
        return rank(a.status) - rank(b.status) || (b.daysOpen ?? -1) - (a.daysOpen ?? -1) || b.lastC.issueDate.localeCompare(a.lastC.issueDate)
      })
  }, [cases, status, code, q])

  const pick = (s: StatusFilter) => (status === s ? 'active' : s)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="ค้างแก้" value={count('open')} sub="REP ตอบ C ยังไม่ได้ส่งแก้ด้วยเลขเดิม" warn={count('open') > 0} active={status === 'open'} onClick={() => setStatus(pick('open'))} />
        <StatCard label="ส่งใหม่แล้ว รอผล" value={count('resent')} sub="ส่งแก้ด้วยเลขเดิมแล้ว รอ REP รอบถัดไป" active={status === 'resent'} onClick={() => setStatus(pick('resent'))} />
        <StatCard label="ผ่านแล้ว" value={count('passed')} sub="REP ล่าสุดเป็น A" active={status === 'passed'} onClick={() => setStatus(pick('passed'))} />
        <StatCard label="ทั้งหมดที่เคยติด C" value={cases.length} sub="กดอีกครั้งเพื่อกลับไปดูที่ยังไม่ปิด" active={status === 'all'} onClick={() => setStatus(status === 'all' ? 'active' : 'all')} />
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ค้นหา encounter_id / ชื่อ / HN / เลขตั้งเบิก / รหัสรายการ"
          className="min-w-[260px] flex-1 rounded-lg border border-ink/30 bg-surface px-3 py-2 text-sm text-ink"
        />
        <select value={code} onChange={(e) => setCode(e.target.value)} className="rounded-lg border border-ink/30 bg-surface px-3 py-2 text-sm text-ink">
          <option value="">ทุกรหัสที่ต้องแก้</option>
          {allCodes.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="rounded-lg border border-ink/30 bg-surface px-3 py-2 text-sm text-ink">
          <option value="active">ยังไม่ปิด (ค้างแก้ + รอผล)</option>
          <option value="all">ทุกสถานะ</option>
          <option value="open">ค้างแก้</option>
          <option value="resent">ส่งใหม่แล้ว รอผล</option>
          <option value="passed">ผ่านแล้ว</option>
        </select>
        <span className="text-xs text-ink/60">{rows.length} เคส</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[1200px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="bg-brand text-ink">
              <th className={th}>สถานะ</th>
              <th className={th}>encounter_id</th>
              <th className={th}>ผู้ป่วย / HN</th>
              <th className={th}>สิทธิ / ผู้จ่าย</th>
              <th className={th}>เลขตั้งเบิกปัจจุบัน</th>
              <th className={th}>REP ล่าสุด</th>
              <th className={th + ' text-center'}>รอบที่ติด C</th>
              <th className={th}>รหัสที่ต้องแก้ (ก่อน 837)</th>
              <th className={th}>วิธีแก้ (master)</th>
              <th className={th + ' text-right'}>ค้าง (วัน)</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-ink/60">
                  {loading ? 'กำลังโหลด…' : cases.length === 0 ? 'ยังไม่มีเคสติด C — บันทึกไฟล์ REP ที่หน้า "ตั้งหนี้ SAP" ก่อน' : 'ไม่พบเคสตามตัวกรอง'}
                </td>
              </tr>
            )}
            {rows.map((c) => {
              const fixes = c.lastC.errors.map((e) => ({ e, fix: fixOf(c, e) }))
              return (
                <tr key={c.key} className="cursor-pointer border-b border-line hover:bg-paper" onClick={() => setOpen(c)}>
                  <td className={td}>
                    <span className={'whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-semibold ' + STATUS_CLS[c.status]}>{STATUS_LABEL[c.status]}</span>
                  </td>
                  <td className={td + ' tabular-nums'}>{c.encounterId}</td>
                  <td className={td}>
                    <div>{c.name ?? '–'}</div>
                    <div className="text-xs text-ink/60">{c.hn ?? ''}</div>
                  </td>
                  <td className={td + ' whitespace-nowrap'}>{c.coverageCode ? `${c.coverageCode} / ${c.payerId}` : '–'}</td>
                  <td className={td + ' whitespace-nowrap'}>{c.currentClaimNo ?? '–'}</td>
                  <td className={td + ' whitespace-nowrap'}>
                    REP {c.latest.repNo}
                    <div className="text-xs text-ink/60">
                      {fmtDate(c.latest.issueDate)} · {c.latest.tcode === 'A' ? 'ผ่าน (A)' : `ไม่ผ่าน (${c.latest.tcode})`}
                    </div>
                  </td>
                  <td className={td + ' text-center tabular-nums'}>{c.cRounds}</td>
                  <td className={td}>
                    <Chips errors={c.lastC.errors} />
                    {c.lastC.warnCount > 0 && <div className="mt-1 text-[11px] text-ink/40">+ เตือน {c.lastC.warnCount} (ไม่ต้องแก้)</div>}
                  </td>
                  <td className={td + ' max-w-[260px]'}>
                    {fixes.length === 0 ? (
                      '–'
                    ) : (
                      <div className="space-y-0.5 text-xs">
                        {fixes.map(({ e, fix }, i) => (
                          <div key={i} className={fix ? 'text-ink' : 'text-ink/40'}>
                            <span className="font-mono font-semibold">{e.code}</span> {fix ?? 'ยังไม่มีวิธีแก้ใน master'}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className={td + ' text-right tabular-nums'}>{c.daysOpen ?? '–'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {open && <CaseModal c={open} master={master} onClose={() => setOpen(null)} />}
    </div>
  )
}

function Chips({ errors }: { errors: CCode[] }) {
  if (errors.length === 0) return <span className="text-ink/40">–</span>
  return (
    <div className="flex flex-wrap gap-1">
      {errors.map((c, i) => (
        <span key={i} className="rounded-md border border-rose/40 bg-rose-soft px-1.5 py-0.5 font-mono text-[12px] font-semibold text-rose">
          {c.code}
          {c.detail ? `:${c.detail}` : ''}
        </span>
      ))}
    </div>
  )
}

function StatCard({ label, value, sub, warn, active, onClick }: { label: string; value: number; sub: string; warn?: boolean; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'rounded-xl border p-4 text-left transition-colors ' +
        (active ? 'border-ink bg-brand ' : warn ? 'border-rose/30 bg-rose-soft/50 hover:bg-rose-soft ' : 'border-line bg-surface hover:bg-brand-soft ')
      }
    >
      <div className="text-xs text-ink/70">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums text-ink">{value}</div>
      <div className="text-xs text-ink/70">{sub}</div>
    </button>
  )
}

/* ───────────── รายละเอียดเคส ───────────── */

function CaseModal({ c, master, onClose }: { c: CCase; master: MasterCode[]; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  const m = (code: string) => master.find((r) => r.payer_id === c.payerId && r.code === code)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4" onClick={onClose}>
      <div className="my-6 w-full max-w-3xl space-y-4 rounded-2xl border border-line bg-surface p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-bold text-ink">
              encounter {c.encounterId} · {c.name ?? '–'}
            </div>
            <div className="text-sm text-ink/70">
              HN {c.hn ?? '–'} · {c.coverageCode ? `${c.coverageCode} / ${c.payerId}` : 'ยังไม่จับคู่เคส'} · จำหน่าย {fmtDate(c.dischargeDate)}
            </div>
            <div className="mt-1 text-sm text-ink/70">
              เลขตั้งเบิกปัจจุบัน {c.currentClaimNo ?? '–'} · ส่งเบิก {fmtDate(c.submissionDate)}
            </div>
          </div>
          <span className={'whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-semibold ' + STATUS_CLS[c.status]}>{STATUS_LABEL[c.status]}</span>
        </div>

        <Section title={`รหัสที่ต้องแก้ — REP ${c.lastC.repNo} (${fmtDate(c.lastC.issueDate)})`}>
          {c.lastC.errors.length === 0 ? (
            <div className="text-sm text-ink/60">ไม่พบรหัส error ก่อน 837 ในบรรทัดนี้</div>
          ) : (
            <div className="space-y-2">
              {c.lastC.errors.map((e, i) => {
                const mr = m(e.code)
                return (
                  <div key={i} className="rounded-lg border border-rose/30 bg-rose-soft/40 p-3 text-sm">
                    <div className="font-mono text-[13px] font-bold text-rose">
                      {e.code}
                      {e.detail ? ` : ${e.detail}` : ''}
                      {e.detail && <span className="ml-2 font-sans text-xs font-normal text-ink/60">← รหัสรายการที่ต้องไปแก้</span>}
                    </div>
                    <div className="mt-1 text-ink">{mr?.description ?? 'ยังไม่มีคำอธิบายรหัสนี้ใน master C'}</div>
                    {mr?.rep_advice && <div className="mt-1 text-xs text-ink/70">คำแนะนำจาก REP: {mr.rep_advice}</div>}
                    <div className={'mt-1 text-xs ' + (mr?.our_fix ? 'font-semibold text-ink' : 'text-ink/40')}>วิธีแก้ของเรา: {mr?.our_fix ?? 'ยังไม่ได้บันทึก (ไปกรอกที่แท็บ Master C)'}</div>
                  </div>
                )
              })}
            </div>
          )}
          {c.lastC.warnCount > 0 && <div className="mt-2 text-xs text-ink/50">รหัสเตือนอีก {c.lastC.warnCount} รายการ (837 / 83A / 926 …) ไม่ต้องแก้ — ดูข้อความเต็มที่ "ดูต้นฉบับ REP" หน้าตั้งหนี้ SAP</div>}
        </Section>

        <Section title="ประวัติผลตอบกลับของเคสนี้ (เลขที่เอกสารตอบรับแต่ละรอบ)">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-xs text-ink/70">
                <th className="py-1 pr-3">REP เลขที่</th>
                <th className="py-1 pr-3">วันที่ตอบกลับ</th>
                <th className="py-1 pr-3">ผล</th>
                <th className="py-1 pr-3">เลขตั้งเบิก ณ รอบนั้น</th>
                <th className="py-1">รหัสที่ต้องแก้</th>
              </tr>
            </thead>
            <tbody>
              {c.rounds.map((r) => (
                <tr key={r.itemId} className="border-b border-line align-top">
                  <td className="py-1.5 pr-3 font-semibold">{r.repNo}</td>
                  <td className="py-1.5 pr-3">{fmtDate(r.issueDate)}</td>
                  <td className={'py-1.5 pr-3 font-semibold ' + (r.tcode === 'A' ? 'text-ink' : 'text-rose')}>{r.tcode === 'A' ? 'ผ่าน (A)' : `ไม่ผ่าน (${r.tcode})`}</td>
                  <td className="py-1.5 pr-3">{r.claimNo ?? '–'}</td>
                  <td className="py-1.5">{r.errors.length ? <Chips errors={r.errors} /> : '–'}</td>
                </tr>
              ))}
              {c.status === 'resent' && (
                <tr className="align-top text-ink/70">
                  <td className="py-1.5 pr-3" colSpan={5}>
                    ส่งใหม่ด้วยเลขตั้งเบิก {c.currentClaimNo} แล้ว — รอ REP รอบถัดไป
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Section>

        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            ปิด
          </Button>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-sm font-bold text-ink">{title}</div>
      {children}
    </div>
  )
}

/* ───────────── Master C ───────────── */

const KIND_LABEL: Record<MasterCode['kind'], string> = { error: 'ต้องแก้ (error)', warning: 'เตือน (ไม่ต้องแก้)', info: 'แจ้งทราบ' }

function MasterTab({ master, cases, onSaved }: { master: MasterCode[]; cases: CCase[]; onSaved: () => void }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [showWarn, setShowWarn] = useState(false)

  const key = (r: MasterCode) => `${r.payer_id}|${r.code}`
  const used = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of cases) for (const e of new Set(c.lastC.errors.map((x) => x.code))) m.set(`${c.payerId}|${e}`, (m.get(`${c.payerId}|${e}`) ?? 0) + 1)
    return m
  }, [cases])

  const list = master.filter((r) => showWarn || r.kind === 'error')

  async function save(r: MasterCode) {
    const v = drafts[key(r)]
    if (v === undefined) return
    setBusy(key(r))
    setErr(null)
    setMsg(null)
    try {
      await saveFix(r.payer_id, r.code, v)
      setDrafts((d) => {
        const n = { ...d }
        delete n[key(r)]
        return n
      })
      setMsg(`บันทึกวิธีแก้ของรหัส ${r.code} แล้ว`)
      onSaved()
    } catch (e) {
      setErr(`บันทึกไม่สำเร็จ: ${(e as { message?: string })?.message ?? String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-4 text-sm text-ink/70">
        Master C เก็บรายรหัสต่อผู้จ่าย (ตอนนี้มีเฉพาะ GGO กรมบัญชีกลาง 50257) — รหัสใหม่ที่พบในไฟล์ REP จะถูกเพิ่มให้เองจากตารางรหัสท้ายไฟล์ ส่วน "วิธีแก้ของเรา" กรอกครั้งเดียวแล้วใช้กับทุกเคส/ทุกไฟล์
      </div>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={showWarn} onChange={(e) => setShowWarn(e.target.checked)} />
        แสดงรหัสเตือน / แจ้งทราบ (837, 83A, 926) ด้วย — ไม่ต้องแก้ ปกติซ่อนไว้
      </label>
      {msg && <div className="rounded-lg border border-line bg-brand-soft px-4 py-2 text-sm text-ink">{msg}</div>}
      {err && <div className="rounded-lg border border-rose/30 bg-rose-soft/50 px-4 py-2 text-sm text-rose">{err}</div>}
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[1000px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="bg-brand text-ink">
              <th className={th}>ผู้จ่าย</th>
              <th className={th}>รหัส</th>
              <th className={th}>ชนิด</th>
              <th className={th}>คำอธิบาย</th>
              <th className={th}>คำแนะนำจาก REP</th>
              <th className={th}>วิธีแก้ของเรา</th>
              <th className={th + ' text-right'}>เคสที่ใช้</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-ink/60">
                  ยังไม่มีรหัสใน master
                </td>
              </tr>
            )}
            {list.map((r) => {
              const k = key(r)
              const val = drafts[k] ?? r.our_fix ?? ''
              const dirty = drafts[k] !== undefined && drafts[k] !== (r.our_fix ?? '')
              return (
                <tr key={k} className="border-b border-line align-top">
                  <td className={td + ' whitespace-nowrap'}>{r.payer_id}</td>
                  <td className={td + ' font-mono font-bold'}>{r.code}</td>
                  <td className={td + ' whitespace-nowrap'}>{KIND_LABEL[r.kind]}</td>
                  <td className={td + ' max-w-[260px]'}>{r.description ?? '–'}</td>
                  <td className={td + ' max-w-[260px] text-xs text-ink/70'}>{r.rep_advice ?? '–'}</td>
                  <td className={td + ' min-w-[280px]'}>
                    <textarea
                      value={val}
                      onChange={(e) => setDrafts((d) => ({ ...d, [k]: e.target.value }))}
                      rows={2}
                      placeholder="วิธีที่เราแก้รหัสนี้"
                      className="w-full rounded-lg border border-ink/30 bg-surface px-2 py-1.5 text-sm text-ink"
                    />
                    {dirty && (
                      <Button type="button" className="mt-1" onClick={() => void save(r)} disabled={busy === k}>
                        {busy === k ? 'กำลังบันทึก…' : 'บันทึก'}
                      </Button>
                    )}
                  </td>
                  <td className={td + ' text-right tabular-nums'}>{used.get(k) ?? 0}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
