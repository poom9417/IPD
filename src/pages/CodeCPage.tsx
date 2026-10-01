import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import type { Admission, CodeCCase } from '../lib/types'

const FETCH_CHUNK = 1000

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })
}

// วัน + เวลาที่ระบบประทับตอนบันทึก (เวลาไทย)
function fmtStamp(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function todayStr() {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

const SELECT_CASES =
  '*, admissions(hn, coverage_code, payer_id, patients(full_name), coverage_master(coverage_name), payer_master(payer_name), case_tracking(submission_date, claim_no))'

async function fetchCases(): Promise<CodeCCase[]> {
  const all: CodeCCase[] = []
  for (let from = 0; ; from += FETCH_CHUNK) {
    const { data, error } = await supabase
      .from('code_c_cases')
      .select(SELECT_CASES)
      .order('reason_at', { ascending: false })
      .range(from, from + FETCH_CHUNK - 1)
    if (error) throw error
    const chunk = (data as unknown as CodeCCase[]) ?? []
    all.push(...chunk)
    if (chunk.length < FETCH_CHUNK) break
  }
  return all
}

// เฉพาะเคสที่ส่งเบิกแล้ว (มี submission_date) — ใช้เป็นตัวเลือกตอนแจ้งติด C
async function fetchSubmitted(): Promise<Admission[]> {
  const all: Admission[] = []
  for (let from = 0; ; from += FETCH_CHUNK) {
    const { data, error } = await supabase
      .from('admissions')
      .select('*, patients(*), coverage_master(*), payer_master(*), case_tracking!inner(*)')
      .not('case_tracking.submission_date', 'is', null)
      .order('admission_id', { ascending: false })
      .range(from, from + FETCH_CHUNK - 1)
    if (error) throw error
    const chunk = (data as unknown as Admission[]) ?? []
    all.push(...chunk)
    if (chunk.length < FETCH_CHUNK) break
  }
  return all
}

/* ---------- Modal: user แจ้งเคสติด C (หรือแก้ไขสาเหตุเดิม) ---------- */
function CodeCForm({
  editing,
  onClose,
  onSaved,
}: {
  editing: CodeCCase | null
  onClose: () => void
  onSaved: () => void
}) {
  const [submitted, setSubmitted] = useState<Admission[]>([])
  const [loadingList, setLoadingList] = useState(!editing)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Admission | null>(null)
  const [reason, setReason] = useState(editing?.reason ?? '')
  const [deadline, setDeadline] = useState(editing?.deadline_date ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (editing) return
    fetchSubmitted()
      .then(setSubmitted)
      .catch((e) => setError((e as { message?: string }).message ?? 'โหลดรายการเคสไม่สำเร็จ'))
      .finally(() => setLoadingList(false))
  }, [editing])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return submitted
      .filter(
        (a) =>
          String(a.encounter_id).includes(q) ||
          a.hn.toLowerCase().includes(q) ||
          (a.patients?.full_name ?? '').toLowerCase().includes(q),
      )
      .slice(0, 8)
  }, [submitted, query])

  const canSave = (editing || picked) && reason.trim() && deadline && !saving

  async function save() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    const res = editing
      ? await supabase
          .from('code_c_cases')
          .update({ reason: reason.trim(), deadline_date: deadline })
          .eq('id', editing.id)
      : await supabase.from('code_c_cases').insert({
          admission_id: picked!.admission_id,
          encounter_id: picked!.encounter_id,
          reason: reason.trim(),
          deadline_date: deadline,
        })
    setSaving(false)
    if (res.error) {
      setError(res.error.message)
      return
    }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl border-t-8 border-brand bg-surface shadow-xl">
        <div className="flex items-center justify-between px-6 pt-5">
          <h2 className="text-base font-semibold text-ink">{editing ? 'แก้ไขสาเหตุติด C' : 'แจ้งเคสติด Code C'}</h2>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-lg leading-none text-ink hover:bg-brand">
            ✕
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-6 py-4">
          {editing ? (
            <p className="rounded-lg bg-paper px-3 py-2 text-sm text-ink">
              encounter_id <span className="font-mono font-semibold">{editing.encounter_id}</span> ·{' '}
              {editing.admissions?.patients?.full_name ?? '—'}
            </p>
          ) : picked ? (
            <div className="flex items-start justify-between gap-3 rounded-lg bg-paper px-3 py-2 text-sm text-ink">
              <div>
                <p>
                  encounter_id <span className="font-mono font-semibold">{picked.encounter_id}</span> ·{' '}
                  {picked.patients?.full_name ?? '—'}
                </p>
                <p className="text-ink/70">
                  {picked.coverage_code} {picked.coverage_master?.coverage_name ?? ''} · ส่งเบิก{' '}
                  {fmtDate(picked.case_tracking?.submission_date ?? null)}
                  {picked.case_tracking?.claim_no ? ` · เลขที่ ${picked.case_tracking.claim_no}` : ''}
                </p>
              </div>
              <button className="shrink-0 text-xs font-semibold underline" onClick={() => setPicked(null)}>
                เปลี่ยนเคส
              </button>
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-sm font-medium text-ink/80">
                เลือกเคสที่ส่งเบิกแล้ว (พิมพ์ชื่อ, encounter_id หรือ HN)
              </label>
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="เช่น 3043836 หรือ ชื่อผู้ป่วย"
                className="input"
              />
              {loadingList && <p className="mt-2 text-sm text-ink/60">กำลังโหลดรายการเคสที่ส่งเบิกแล้ว…</p>}
              {!loadingList && query.trim() && matches.length === 0 && (
                <p className="mt-2 text-sm text-ink/60">ไม่พบเคส (ต้องเป็นเคสที่บันทึกวันส่งเบิกแล้วเท่านั้น)</p>
              )}
              {matches.length > 0 && (
                <ul className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-line">
                  {matches.map((a) => (
                    <li key={a.admission_id}>
                      <button
                        type="button"
                        onClick={() => setPicked(a)}
                        className="w-full border-b border-line px-3 py-2 text-left text-sm last:border-0 hover:bg-brand-soft"
                      >
                        <span className="font-mono font-semibold">{a.encounter_id}</span> ·{' '}
                        {a.patients?.full_name ?? '—'}
                        <span className="block text-xs text-ink/70">
                          {a.coverage_code} {a.coverage_master?.coverage_name ?? ''} · {a.payer_master?.payer_name ?? '—'} ·
                          ส่งเบิก {fmtDate(a.case_tracking?.submission_date ?? null)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-ink/80">ติด C เพราะอะไร (รายละเอียดที่ระบบแจ้ง)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              className="input resize-y"
              placeholder="เช่น รหัสหัตถการไม่สอดคล้องกับวินิจฉัย / เอกสารแนบไม่ครบ"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink/80">Dateline (วันที่ต้องแก้ให้เสร็จ)</label>
            <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="input" />
          </div>

          {error && <p className="text-sm text-rose">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
          <button onClick={onClose} className="rounded-lg border border-ink/40 px-4 py-2 text-sm font-medium text-ink hover:bg-brand-soft">
            ยกเลิก
          </button>
          <button
            onClick={save}
            disabled={!canSave}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-ink hover:bg-brand-dark disabled:opacity-50"
          >
            {saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------- Modal: audit ตอบว่าแก้ไขอย่างไร ---------- */
function ReplyForm({
  item,
  onClose,
  onSaved,
}: {
  item: CodeCCase
  onClose: () => void
  onSaved: () => void
}) {
  const [fix, setFix] = useState(item.fix_detail ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!fix.trim()) return
    setSaving(true)
    setError(null)
    const { error } = await supabase.from('code_c_cases').update({ fix_detail: fix.trim() }).eq('id', item.id)
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl border-t-8 border-brand bg-surface shadow-xl">
        <div className="flex items-center justify-between px-6 pt-5">
          <h2 className="text-base font-semibold text-ink">Audit — บันทึกการแก้ไข Code C</h2>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-lg leading-none text-ink hover:bg-brand">
            ✕
          </button>
        </div>
        <div className="space-y-4 overflow-y-auto px-6 py-4">
          <div className="rounded-lg bg-paper px-3 py-2 text-sm text-ink">
            <p>
              encounter_id <span className="font-mono font-semibold">{item.encounter_id}</span> ·{' '}
              {item.admissions?.patients?.full_name ?? '—'}
            </p>
            <p className="mt-1 text-ink/80">
              <span className="font-semibold">สาเหตุ:</span> {item.reason}
            </p>
            <p className="text-xs text-ink/60">
              แจ้งโดย {item.reason_by_email ?? '—'} · {fmtStamp(item.reason_at)} · dateline {fmtDate(item.deadline_date)}
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink/80">แก้ไขอย่างไร</label>
            <textarea
              autoFocus
              value={fix}
              onChange={(e) => setFix(e.target.value)}
              rows={5}
              className="input resize-y"
              placeholder="เช่น แก้รหัส ICD-9 เป็น … แนบเอกสาร … แล้ว ส่งเบิกซ้ำ"
            />
          </div>
          {error && <p className="text-sm text-rose">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
          <button onClick={onClose} className="rounded-lg border border-ink/40 px-4 py-2 text-sm font-medium text-ink hover:bg-brand-soft">
            ยกเลิก
          </button>
          <button
            onClick={save}
            disabled={!fix.trim() || saving}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-ink hover:bg-brand-dark disabled:opacity-50"
          >
            {saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------- หน้า Code C ---------- */
type StatusFilter = '' | 'open' | 'done'

export default function CodeCPage() {
  const { role, session } = useAuth()
  const myId = session?.user.id ?? ''
  const isAdmin = role === 'admin'
  const canReport = role === 'admin' || role === 'user'
  const canReply = role === 'admin' || role === 'audit'

  const [cases, setCases] = useState<CodeCCase[]>([])
  const [myCoverages, setMyCoverages] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusFilter>('')
  const [onlyMine, setOnlyMine] = useState(false)
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<CodeCCase | null>(null)
  const [replying, setReplying] = useState<CodeCCase | null>(null)

  async function load() {
    setLoading(true)
    setLoadError(null)
    try {
      setCases(await fetchCases())
    } catch (e) {
      setLoadError((e as { message?: string }).message ?? 'โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (!myId) return
    supabase
      .from('coverage_assignments')
      .select('coverage_code')
      .eq('user_id', myId)
      .then(({ data }) => setMyCoverages((data ?? []).map((r) => r.coverage_code as string)))
  }, [myId])

  const today = todayStr()

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return cases.filter((c) => {
      const done = !!c.fix_detail
      if (status === 'open' && done) return false
      if (status === 'done' && !done) return false
      if (onlyMine && !myCoverages.includes(c.admissions?.coverage_code ?? '')) return false
      if (
        q &&
        !(
          String(c.encounter_id).includes(q) ||
          (c.admissions?.patients?.full_name ?? '').toLowerCase().includes(q) ||
          (c.admissions?.hn ?? '').toLowerCase().includes(q)
        )
      )
        return false
      return true
    })
  }, [cases, status, onlyMine, myCoverages, search])

  const openCount = cases.filter((c) => !c.fix_detail).length
  const overdueCount = cases.filter((c) => !c.fix_detail && c.deadline_date < today).length

  async function remove(c: CodeCCase) {
    if (!window.confirm(`ลบรายการ Code C ของ encounter_id ${c.encounter_id} ?`)) return
    const { error } = await supabase.from('code_c_cases').delete().eq('id', c.id)
    if (error) alert(`ลบไม่สำเร็จ: ${error.message}`)
    else load()
  }

  return (
    <main className="w-full space-y-5 px-4 py-6 sm:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">Code C — เคสติด C หลังส่งเบิก</h1>
          <p className="mt-1 text-sm text-ink/70">
            user แจ้งสาเหตุที่ติด C พร้อม dateline → audit ตอบว่าแก้ไขอย่างไร ระบบประทับวันเวลาและชื่อผู้บันทึกของทั้งสองฝั่งให้อัตโนมัติ
          </p>
        </div>
        {canReport && (
          <button
            onClick={() => setFormOpen(true)}
            className="whitespace-nowrap rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-ink hover:bg-brand-dark"
          >
            + แจ้งเคสติด C
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: 'ทั้งหมด', value: cases.length },
          { label: 'รอ Audit แก้ไข', value: openCount },
          { label: 'เกิน dateline', value: overdueCount },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-line border-l-8 border-l-brand bg-surface px-5 py-4">
            <p className="text-sm font-medium text-ink/70">{s.label}</p>
            <p className="mt-1 text-3xl font-bold text-ink">{s.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อ / encounter_id / HN"
          className="input sm:max-w-xs"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="input w-auto">
          <option value="">ทุกสถานะ</option>
          <option value="open">รอ Audit แก้ไข</option>
          <option value="done">แก้ไขแล้ว</option>
        </select>
        {myCoverages.length > 0 && (
          <button
            onClick={() => setOnlyMine((v) => !v)}
            className={
              'whitespace-nowrap rounded-lg border px-4 py-2 text-sm font-medium transition-colors ' +
              (onlyMine ? 'border-ink bg-brand text-ink' : 'border-ink/30 text-ink hover:bg-brand-soft hover:border-ink')
            }
          >
            เฉพาะสิทธิของฉัน
          </button>
        )}
      </div>

      {loadError && (
        <div className="flex items-center justify-between rounded-lg border border-rose/30 bg-rose-soft/50 px-4 py-2 text-sm text-rose">
          <span>โหลดข้อมูลไม่สำเร็จ: {loadError}</span>
          <button onClick={load} className="underline">
            ลองใหม่
          </button>
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-line bg-surface p-8 text-center text-sm text-ink/60">กำลังโหลดข้อมูล…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface p-8 text-center text-sm text-ink/50">
          ไม่มีรายการ Code C ที่ตรงเงื่อนไข
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead>
              <tr className="bg-brand text-[13px] text-ink">
                <th className="whitespace-nowrap px-3 py-3 font-semibold">encounter_id</th>
                <th className="px-3 py-3 font-semibold">ผู้ป่วย / สิทธิ</th>
                <th className="whitespace-nowrap px-3 py-3 font-semibold">ส่งเบิก</th>
                <th className="min-w-[14rem] px-3 py-3 font-semibold">สาเหตุที่ติด C (User)</th>
                <th className="whitespace-nowrap px-3 py-3 font-semibold">Dateline</th>
                <th className="min-w-[14rem] px-3 py-3 font-semibold">แก้ไขอย่างไร (Audit)</th>
                <th className="whitespace-nowrap px-3 py-3 font-semibold text-right">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const done = !!c.fix_detail
                const overdue = !done && c.deadline_date < today
                const canEditReason = !done && (isAdmin || (role === 'user' && c.reason_by === myId))
                return (
                  <tr key={c.id} className="border-b border-line align-top last:border-0 hover:bg-paper">
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[13px] font-semibold text-ink">
                      {c.encounter_id}
                    </td>
                    <td className="min-w-[10rem] px-3 py-2.5 text-ink">
                      <p>{c.admissions?.patients?.full_name ?? '—'}</p>
                      <p className="text-xs text-ink/70">
                        <span className="font-mono font-semibold">{c.admissions?.coverage_code}</span>{' '}
                        {c.admissions?.coverage_master?.coverage_name ?? ''}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-ink">
                      {fmtDate(c.admissions?.case_tracking?.submission_date ?? null)}
                      {c.admissions?.case_tracking?.claim_no && (
                        <p className="text-xs text-ink/70">{c.admissions.case_tracking.claim_no}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-ink">
                      <p className="whitespace-pre-wrap break-words">{c.reason}</p>
                      <p className="mt-1 text-xs text-ink/60">
                        {c.reason_by_email ?? '—'} · {fmtStamp(c.reason_at)}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <span
                        className={
                          'rounded-full px-2.5 py-0.5 text-xs font-semibold ' +
                          (overdue ? 'bg-rose-soft text-rose' : done ? 'bg-brand text-ink' : 'border border-line text-ink')
                        }
                      >
                        {fmtDate(c.deadline_date)}
                      </span>
                      {overdue && <p className="mt-1 text-xs text-rose">เกิน dateline</p>}
                    </td>
                    <td className="px-3 py-2.5 text-ink">
                      {done ? (
                        <>
                          <p className="whitespace-pre-wrap break-words">{c.fix_detail}</p>
                          <p className="mt-1 text-xs text-ink/60">
                            {c.fix_by_email ?? '—'} · {fmtStamp(c.fix_at)}
                          </p>
                        </>
                      ) : (
                        <span className="text-ink/45">รอ Audit ตอบ</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      <div className="flex justify-end gap-1.5">
                        {canReply && (
                          <button
                            onClick={() => setReplying(c)}
                            className="rounded-md bg-brand px-3 py-1 text-sm font-semibold text-ink hover:bg-brand-dark"
                          >
                            {done ? 'แก้คำตอบ' : 'ตอบ'}
                          </button>
                        )}
                        {canEditReason && (
                          <button
                            onClick={() => setEditing(c)}
                            className="rounded-md border border-ink/40 px-3 py-1 text-sm font-medium text-ink hover:bg-brand"
                          >
                            แก้สาเหตุ
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            onClick={() => remove(c)}
                            className="rounded-md border border-rose/40 px-3 py-1 text-sm font-medium text-rose hover:bg-rose-soft"
                          >
                            ลบ
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && (
        <CodeCForm
          editing={null}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false)
            load()
          }}
        />
      )}
      {editing && (
        <CodeCForm
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}
      {replying && (
        <ReplyForm
          item={replying}
          onClose={() => setReplying(null)}
          onSaved={() => {
            setReplying(null)
            load()
          }}
        />
      )}
    </main>
  )
}
