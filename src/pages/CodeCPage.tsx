import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { pairKey } from '../lib/pairKey'
import { useAuth } from '../contexts/AuthContext'
import type { Admission, CodeCCase, CodeCHistory } from '../lib/types'

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

const DEADLINE_DAYS = 7

function bkkDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
}

function dayDiff(from: string, to: string) {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000)
}

// Dateline อัตโนมัติ: นับจากวันจำหน่าย → ถึงวันที่ Audit ตอบ (ถ้าตอบแล้ว) หรือถึงวันนี้ (ถ้ายังไม่เสร็จ/ถูกกดไม่ผ่าน = นับต่อ ไม่รีเซ็ต)
function calcDateline(c: CodeCCase, today: string) {
  const dis = c.admissions?.discharge_date ?? null
  if (!c.auto_deadline || !dis) return null
  const end = c.status === 'answered' && c.fix_at ? bkkDate(c.fix_at) : today
  const elapsed = dayDiff(dis, end)
  return { elapsed, overdue: Math.max(elapsed - DEADLINE_DAYS, 0), due: c.deadline_date }
}

const KIND_LABEL: Record<CodeCHistory['kind'], string> = {
  reason: 'สาเหตุที่ติด C',
  answer: 'Audit ตอบ',
  edit: 'Audit แก้คำตอบ',
  reopen: 'user กด "ไม่ผ่านการแก้ C"',
}

function sortedHistory(c: CodeCCase) {
  return [...(c.code_c_history ?? [])].sort((a, b) => a.id - b.id)
}

/* ไทม์ไลน์ประวัติทุกรอบ: ตอบอะไรไปแล้วบ้าง เมื่อไร */
function HistoryList({ item, skipLast }: { item: CodeCCase; skipLast?: boolean }) {
  let rows = sortedHistory(item)
  if (skipLast) rows = rows.filter((h) => !(h.round_no === item.round_no && (h.kind === 'answer' || h.kind === 'edit')))
  if (rows.length === 0) return null
  return (
    <ol className="space-y-2 border-l-2 border-brand pl-3">
      {rows.map((h) => (
        <li key={h.id} className="text-xs text-ink">
          <p className="font-semibold">
            รอบ {h.round_no} · {KIND_LABEL[h.kind]}
            <span className="ml-1 font-normal text-ink/60">
              {h.by_email ?? '—'} · {fmtStamp(h.at)}
            </span>
          </p>
          {h.body && <p className="whitespace-pre-wrap break-words text-ink/80">{h.body}</p>}
          {h.kind === 'edit' && h.prev_body && (
            <p className="whitespace-pre-wrap break-words text-ink/50">คำตอบเดิม: {h.prev_body}</p>
          )}
        </li>
      ))}
    </ol>
  )
}

const SELECT_CASES =
  '*, code_c_history(id, round_no, kind, body, prev_body, by_email, at), admissions(hn, discharge_date, coverage_code, payer_id, patients(full_name), coverage_master(coverage_name), payer_master(payer_name), case_tracking(submission_date, claim_no))'

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

  const canSave = (editing || picked) && reason.trim() && !saving

  async function save() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    const res = editing
      ? await supabase
          .from('code_c_cases')
          .update({ reason: reason.trim() })
          .eq('id', editing.id)
      : await supabase.from('code_c_cases').insert({
          admission_id: picked!.admission_id,
          encounter_id: picked!.encounter_id,
          reason: reason.trim(),
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

          <p className="rounded-lg bg-paper px-3 py-2 text-xs text-ink/70">
            Dateline ระบบนับให้อัตโนมัติ: วันที่จำหน่าย + {DEADLINE_DAYS} วัน (ไม่ต้องกรอกเอง)
          </p>

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
          {item.round_no > 1 && (
            <p className="rounded-lg bg-rose-soft/50 px-3 py-2 text-sm font-semibold text-rose">
              รอบที่ {item.round_no} — user แจ้งว่าการแก้ครั้งก่อนไม่ผ่าน ดูวิธีที่แก้ไปแล้วด้านล่างก่อนตอบ
            </p>
          )}
          {(item.code_c_history ?? []).some((h) => h.kind !== 'reason' || h.round_no > 1) && (
            <div>
              <p className="mb-1 text-sm font-medium text-ink/80">ประวัติการแก้ไขที่ผ่านมา</p>
              <div className="max-h-48 overflow-y-auto">
                <HistoryList item={item} skipLast />
              </div>
            </div>
          )}
          {item.status === 'answered' && (
            <p className="text-xs text-ink/60">คำตอบเดิมจะถูกเก็บไว้ในประวัติ (ไม่ถูกเขียนทับ) พร้อมวันที่แก้</p>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-ink/80">
              {item.status === 'answered' ? 'แก้คำตอบ' : `แก้ไขอย่างไร${item.round_no > 1 ? ` (รอบที่ ${item.round_no})` : ''}`}
            </label>
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

/* ---------- Modal: user กด "ไม่ผ่านการแก้ C" (ยืนยันก่อนเสมอ) ---------- */
function ReopenConfirm({
  item,
  onClose,
  onDone,
}: {
  item: CodeCCase
  onClose: () => void
  onDone: () => void
}) {
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (saving) return
    setSaving(true)
    setError(null)
    const { error } = await supabase.rpc('code_c_reopen', { p_case_id: item.id, p_note: note.trim() || null })
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4">
      <div className="w-full max-w-md rounded-2xl border-t-8 border-rose bg-surface shadow-xl">
        <div className="space-y-3 px-6 py-5">
          <h2 className="text-base font-semibold text-ink">ยืนยัน "ไม่ผ่านการแก้ C" ?</h2>
          <p className="rounded-lg bg-paper px-3 py-2 text-sm text-ink">
            encounter_id <span className="font-mono font-semibold">{item.encounter_id}</span> ·{' '}
            {item.admissions?.patients?.full_name ?? '—'}
          </p>
          <p className="text-sm text-ink/80">
            เคสนี้จะกลับไปเป็น <span className="font-semibold">รอ Audit แก้ไข</span> (รอบที่ {item.round_no + 1}) และ dateline
            นับต่อจากวันจำหน่ายโดยไม่รีเซ็ต ถ้าการแก้ครั้งก่อนไม่มีปัญหา ไม่ต้องกดอะไร ระบบถือว่าผ่านแล้ว
          </p>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink/80">เหตุผลที่ไม่ผ่าน (ไม่บังคับ)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="input resize-y"
              placeholder="เช่น แก้แล้วยังติด C ด้วยเหตุผลเดิม"
            />
          </div>
          {error && <p className="text-sm text-rose">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
          <button onClick={onClose} className="rounded-lg border border-ink/40 px-4 py-2 text-sm font-medium text-ink hover:bg-brand-soft">
            ยกเลิก
          </button>
          <button
            onClick={confirm}
            disabled={saving}
            className="rounded-lg bg-rose px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'กำลังบันทึก…' : 'ตกลง ไม่ผ่าน'}
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
  const canReopen = role === 'user' // developer ทดสอบผ่านโหมดจำลอง user
  // ปุ่ม "เฉพาะสิทธิของฉัน": เฉพาะ role ที่มีสิทธิ์ที่ดูแลของตัวเอง (My job) — audit / viewer ไม่มี จึงไม่แสดงปุ่ม
  const canFilterMine = role === 'admin' || role === 'user'

  const [cases, setCases] = useState<CodeCCase[]>([])
  const [myPairs, setMyPairs] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusFilter>('')
  const [onlyMine, setOnlyMine] = useState(false)
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<CodeCCase | null>(null)
  const [replying, setReplying] = useState<CodeCCase | null>(null)
  const [reopening, setReopening] = useState<CodeCCase | null>(null)

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
      .select('coverage_code, payer_id')
      .eq('user_id', myId)
      .then(({ data }) =>
        setMyPairs(new Set((data ?? []).map((r) => pairKey(r.coverage_code as string, r.payer_id as string)))),
      )
  }, [myId])

  const today = todayStr()

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return cases.filter((c) => {
      const done = c.status === 'answered'
      if (status === 'open' && done) return false
      if (status === 'done' && !done) return false
      if (canFilterMine && onlyMine && !myPairs.has(pairKey(c.admissions?.coverage_code, c.admissions?.payer_id))) return false
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
  }, [cases, status, onlyMine, myPairs, search, canFilterMine])

  const isOverdue = (c: CodeCCase) => {
    const dl = calcDateline(c, today)
    return dl ? dl.overdue > 0 : c.status === 'pending' && c.deadline_date < today
  }
  const openCount = cases.filter((c) => c.status === 'pending').length
  const overdueCount = cases.filter((c) => isOverdue(c)).length

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
            user แจ้งสาเหตุที่ติด C → audit ตอบว่าแก้ไขอย่างไร (ถือว่าผ่านอัตโนมัติ) · ถ้าแก้แล้วยังไม่ผ่าน user กด "ไม่ผ่านการแก้ C" เพื่อส่งกลับให้ audit แก้ซ้ำ · dateline นับจากวันจำหน่าย + 7 วันให้เอง
          </p>
        </div>
        {canReport && (
          <button
            data-tour="codec-report"
            onClick={() => setFormOpen(true)}
            className="whitespace-nowrap rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-ink hover:bg-brand-dark"
          >
            + แจ้งเคสติด C
          </button>
        )}
      </div>

      <div data-tour="codec-stats" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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

      <div data-tour="codec-filters" className="flex flex-wrap items-center gap-2">
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
        {canFilterMine && myPairs.size > 0 && (
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
        <div data-tour="codec-table" className="overflow-x-auto rounded-xl border border-line bg-surface">
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
                const done = c.status === 'answered'
                const dl = calcDateline(c, today)
                const overdue = isOverdue(c)
                const canEditReason = !done && (isAdmin || (role === 'user' && c.reason_by === myId))
                const history = sortedHistory(c)
                const hasPast = history.some((h) => h.kind !== 'reason' || h.round_no > 1 || h.prev_body)
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
                      {dl ? (
                        <p className={'mt-1 text-xs ' + (overdue ? 'font-semibold text-rose' : 'text-ink/70')}>
                          วันที่ {dl.elapsed} / {DEADLINE_DAYS}
                          {overdue ? ` · เกิน ${dl.overdue} วัน` : ''}
                          {done ? ' (หยุดนับ)' : ''}
                        </p>
                      ) : (
                        overdue && <p className="mt-1 text-xs text-rose">เกิน dateline</p>
                      )}
                      {c.round_no > 1 && (
                        <p className="mt-1 text-xs font-semibold text-ink">รอบที่ {c.round_no}</p>
                      )}
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
                        <span className="text-ink/45">
                          {c.round_no > 1 ? `รอ Audit แก้ไข (รอบที่ ${c.round_no})` : 'รอ Audit ตอบ'}
                        </span>
                      )}
                      {hasPast && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs font-semibold text-ink underline">
                            ประวัติการแก้ไข ({history.length})
                          </summary>
                          <div className="mt-2">
                            <HistoryList item={c} />
                          </div>
                        </details>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      <div className="flex justify-end gap-1.5">
                        {canReply && (
                          <button
                            data-tour="codec-reply"
                            onClick={() => setReplying(c)}
                            className="rounded-md bg-brand px-3 py-1 text-sm font-semibold text-ink hover:bg-brand-dark"
                          >
                            {done ? 'แก้คำตอบ' : c.round_no > 1 ? `ตอบรอบที่ ${c.round_no}` : 'ตอบ'}
                          </button>
                        )}
                        {canReopen && done && (
                          <button
                            data-tour="codec-reopen"
                            onClick={() => setReopening(c)}
                            className="rounded-md border border-rose/50 px-3 py-1 text-sm font-semibold text-rose hover:bg-rose-soft"
                          >
                            ไม่ผ่านการแก้ C
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
      {reopening && (
        <ReopenConfirm
          item={reopening}
          onClose={() => setReopening(null)}
          onDone={() => {
            setReopening(null)
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
