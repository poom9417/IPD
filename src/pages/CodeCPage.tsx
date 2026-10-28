import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { pairKey } from '../lib/pairKey'
import { useAuth } from '../contexts/AuthContext'
import type { Admission, CodeCCase, CodeCHistory, CodeCItem, CodeType } from '../lib/types'
import Button from '../components/ui/Button'

const FETCH_CHUNK = 1000
const DEADLINE_DAYS = 7

/* ---------- helpers ---------- */
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

function bkkDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
}

function dayDiff(from: string, to: string) {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000)
}

function addDays(d: string, n: number) {
  const t = new Date(d)
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}

const TYPE_LABEL: Record<CodeType, string> = { disease: 'โรค', device: 'อุปกรณ์' }

/**
 * Dateline รายแถว: นับจากวันที่ส่งเบิก (+7 วัน) — คำนวณสดทุกครั้ง ไม่เก็บค่าตายตัว
 * หยุดนับตอน Audit ตอบแถวนั้น · ถ้าถูกกด "ไม่ผ่านการแก้ C" จะนับต่อ (ไม่รีเซ็ต)
 */
function calcDateline(item: CodeCItem, submission: string | null, today: string) {
  if (!submission) return null
  const stopped = (item.status === 'answered' || item.status === 'passed') && item.fix_at
  const end = stopped ? bkkDate(item.fix_at as string) : today
  const elapsed = dayDiff(submission, end)
  return {
    elapsed,
    overdue: Math.max(elapsed - DEADLINE_DAYS, 0),
    due: addDays(submission, DEADLINE_DAYS),
    stopped: !!stopped,
  }
}

function codeLabel(i: CodeCItem) {
  const t = i.code_type ? `[${TYPE_LABEL[i.code_type]}] ` : ''
  return `${t}${i.code ?? '—'}`
}

const KIND_LABEL: Record<CodeCHistory['kind'], string> = {
  reason: 'สาเหตุที่ติด C',
  answer: 'Audit ตอบ',
  edit: 'Audit แก้คำตอบ',
  reopen: 'user กด "ไม่ผ่านการแก้ C"',
  pass: 'user กด "ผ่านการแก้ C" (ปิดแถว)',
}

function sortedHistory(i: CodeCItem) {
  return [...(i.code_c_history ?? [])].sort((a, b) => a.id - b.id)
}

/* ไทม์ไลน์ประวัติทุกรอบของ 1 แถวรหัส: ตอบอะไรไปแล้วบ้าง เมื่อไร */
function HistoryList({ item, skipCurrentAnswer }: { item: CodeCItem; skipCurrentAnswer?: boolean }) {
  let rows = sortedHistory(item)
  if (skipCurrentAnswer)
    rows = rows.filter((h) => !(h.round_no === item.round_no && (h.kind === 'answer' || h.kind === 'edit')))
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
  '*, code_c_items(*, code_c_history(id, round_no, kind, body, prev_body, by_email, at)), admissions(hn, discharge_date, coverage_code, payer_id, patients:patients_v(full_name), coverage_master(coverage_name), payer_master(payer_name), case_tracking(submission_date, claim_no))'

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
      .select('*, patients:patients_v(*), coverage_master(*), payer_master(*), case_tracking!inner(encounter_id, document_received_date, audit_date, submission_date, claim_no, admission_id, updated_at, updated_by)')
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

/* ---------- Modal: user แจ้งเคสติด C — เพิ่มรหัสทีละแถว ---------- */
interface Target {
  admission_id: number
  encounter_id: number
  name: string
  line: string
}

interface Draft {
  code_type: CodeType | ''
  code: string
  reason: string
}

const EMPTY_DRAFT: Draft = { code_type: '', code: '', reason: '' }
const draftOk = (d: Draft) => !!d.code_type && !!d.code.trim() && !!d.reason.trim()

function CodeCForm({
  preset,
  onClose,
  onSaved,
}: {
  preset: Target | null
  onClose: () => void
  onSaved: () => void
}) {
  const [submitted, setSubmitted] = useState<Admission[]>([])
  const [loadingList, setLoadingList] = useState(!preset)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Target | null>(preset)
  const [rows, setRows] = useState<Draft[]>([])
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const typeRef = useRef<HTMLSelectElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)
  const reasonRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (preset) return
    fetchSubmitted()
      .then(setSubmitted)
      .catch((e) => setError((e as { message?: string }).message ?? 'โหลดรายการเคสไม่สำเร็จ'))
      .finally(() => setLoadingList(false))
  }, [preset])

  useEffect(() => {
    if (picked) typeRef.current?.focus()
  }, [picked])

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

  function pick(a: Admission) {
    setPicked({
      admission_id: a.admission_id,
      encounter_id: a.encounter_id,
      name: a.patients?.full_name ?? '—',
      line: `${a.coverage_code} ${a.coverage_master?.coverage_name ?? ''} · ส่งเบิก ${fmtDate(a.case_tracking?.submission_date ?? null)}${
        a.case_tracking?.claim_no ? ` · เลขที่ ${a.case_tracking.claim_no}` : ''
      }`,
    })
  }

  // Enter = ไปช่องถัดไป · Enter ที่ช่องสุดท้าย = เก็บแถวนี้ไว้ในรายการ แล้วเริ่มแถวใหม่
  function commitDraft() {
    if (!draftOk(draft)) return false
    setRows((r) => [...r, { ...draft, code: draft.code.trim(), reason: draft.reason.trim() }])
    setDraft(EMPTY_DRAFT)
    setTimeout(() => typeRef.current?.focus(), 0)
    return true
  }

  const toSave = draftOk(draft) ? [...rows, { ...draft, code: draft.code.trim(), reason: draft.reason.trim() }] : rows
  const canSave = !!picked && toSave.length > 0 && !saving

  async function save() {
    if (!canSave || !picked) return
    setSaving(true)
    setError(null)
    const { error } = await supabase.rpc('code_c_add_items', {
      p_admission_id: picked.admission_id,
      p_items: toSave.map((r) => ({ code_type: r.code_type, code: r.code, reason: r.reason })),
    })
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    onSaved()
  }

  return (
    <div className="modal-overlay">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border-t-8 border-brand bg-surface shadow-xl">
        <div className="flex items-center justify-between px-6 pt-5">
          <h2 className="text-base font-semibold text-ink">แจ้งเคสติด Code C</h2>
          <Button variant="icon" onClick={onClose}>
            ✕
          </Button>
        </div>

        <div className="space-y-4 overflow-y-auto px-6 py-4">
          {picked ? (
            <div className="flex items-start justify-between gap-3 rounded-lg bg-paper px-3 py-2 text-sm text-ink">
              <div>
                <p>
                  encounter_id <span className="font-mono font-semibold">{picked.encounter_id}</span> · {picked.name}
                </p>
                <p className="text-ink/70">{picked.line}</p>
              </div>
              {!preset && rows.length === 0 && (
                <button className="shrink-0 text-xs font-semibold underline" onClick={() => setPicked(null)}>
                  เปลี่ยนเคส
                </button>
              )}
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
                className="form-input"
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
                        onClick={() => pick(a)}
                        className="w-full border-b border-line px-3 py-2 text-left text-sm last:border-0 hover:bg-brand-soft"
                      >
                        <span className="font-mono font-semibold">{a.encounter_id}</span> · {a.patients?.full_name ?? '—'}
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

          {picked && (
            <>
              {rows.length > 0 && (
                <div>
                  <p className="mb-1 text-sm font-medium text-ink/80">รหัสที่เพิ่มแล้ว ({rows.length})</p>
                  <ul className="space-y-1.5">
                    {rows.map((r, idx) => (
                      <li
                        key={idx}
                        className="flex items-start gap-2 rounded-lg border border-line bg-brand-soft/40 px-3 py-2 text-sm text-ink"
                      >
                        <span className="mt-0.5 rounded-full bg-brand px-2 py-0.5 text-xs font-semibold">✓ เพิ่มแล้ว</span>
                        <span className="min-w-0 flex-1">
                          <span className="font-semibold">
                            [{r.code_type ? TYPE_LABEL[r.code_type] : ''}] {r.code}
                          </span>
                          <span className="block break-words text-ink/80">{r.reason}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setRows((x) => x.filter((_, i) => i !== idx))}
                          className="shrink-0 rounded px-1.5 text-ink/60 hover:bg-rose-soft hover:text-rose"
                          title="เอาแถวนี้ออก (ก่อนกดยืนยัน)"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <p className="mb-1 text-sm font-medium text-ink/80">
                  {rows.length === 0 ? 'เพิ่มรหัสที่ติด C' : 'เพิ่มรหัสถัดไป'}
                  <span className="ml-2 text-xs font-normal text-ink/50">กรอกแล้วกด Enter เพื่อไปช่องถัดไป</span>
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[8rem_10rem_1fr]">
                  <select
                    ref={typeRef}
                    value={draft.code_type}
                    onChange={(e) => setDraft({ ...draft, code_type: e.target.value as Draft['code_type'] })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        codeRef.current?.focus()
                      }
                    }}
                    className="form-input"
                  >
                    <option value="">ชนิดรหัส</option>
                    <option value="disease">โรค</option>
                    <option value="device">อุปกรณ์</option>
                  </select>
                  <input
                    ref={codeRef}
                    value={draft.code}
                    onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        reasonRef.current?.focus()
                      }
                    }}
                    placeholder="รหัส เช่น K35.8 / 4404"
                    className="form-input font-mono"
                  />
                  <input
                    ref={reasonRef}
                    value={draft.reason}
                    onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitDraft()
                      }
                    }}
                    placeholder="สาเหตุที่ติด C (สั้นๆ)"
                    className="form-input"
                  />
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-xs text-ink/60">
                    Dateline นับให้อัตโนมัติ: วันที่ส่งเบิก + {DEADLINE_DAYS} วัน (ไม่ต้องกรอกเอง)
                  </p>
                  <button
                    type="button"
                    onClick={commitDraft}
                    disabled={!draftOk(draft)}
                    className="whitespace-nowrap rounded-lg border border-ink/40 px-3 py-1.5 text-sm font-medium text-ink hover:bg-brand disabled:opacity-40"
                  >
                    + เพิ่มรหัสนี้
                  </button>
                </div>
              </div>
            </>
          )}

          {error && <p className="text-sm text-rose">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line px-6 py-4">
          <p className="text-xs text-ink/60">
            {toSave.length > 0 ? `จะบันทึก ${toSave.length} รหัส เมื่อกดยืนยัน Code C` : 'ยังไม่ได้บันทึกอะไรลงระบบ'}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              ยกเลิก
            </Button>
            <Button
              variant="primary"
              onClick={save}
              disabled={!canSave}
            >
              {saving ? 'กำลังบันทึก…' : 'ยืนยัน Code C'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- Modal: admin แก้ชนิดรหัส / รหัส / สาเหตุ ของแถวที่มีอยู่ (เช่นข้อมูลเก่า) ---------- */
function ItemEditForm({
  item,
  c,
  onClose,
  onSaved,
}: {
  item: CodeCItem
  c: CodeCCase
  onClose: () => void
  onSaved: () => void
}) {
  const [codeType, setCodeType] = useState<CodeType | ''>(item.code_type ?? '')
  const [code, setCode] = useState(item.code ?? '')
  const [reason, setReason] = useState(item.reason)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const codeRef = useRef<HTMLInputElement>(null)
  const reasonRef = useRef<HTMLInputElement>(null)

  async function save() {
    if (saving || !reason.trim()) return
    setSaving(true)
    setError(null)
    const { error } = await supabase
      .from('code_c_items')
      .update({ code_type: codeType || null, code: code.trim() || null, reason: reason.trim() })
      .eq('id', item.id)
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    onSaved()
  }

  return (
    <div className="modal-overlay">
      <div className="w-full max-w-lg rounded-2xl border-t-8 border-brand bg-surface shadow-xl">
        <div className="space-y-3 px-6 py-5">
          <h2 className="text-base font-semibold text-ink">แก้ไขรหัสที่ติด C</h2>
          <p className="rounded-lg bg-paper px-3 py-2 text-sm text-ink">
            encounter_id <span className="font-mono font-semibold">{c.encounter_id}</span> ·{' '}
            {c.admissions?.patients?.full_name ?? '—'}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[8rem_1fr]">
            <select
              autoFocus
              value={codeType}
              onChange={(e) => setCodeType(e.target.value as CodeType | '')}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), codeRef.current?.focus())}
              className="form-input"
            >
              <option value="">ไม่ระบุชนิด</option>
              <option value="disease">โรค</option>
              <option value="device">อุปกรณ์</option>
            </select>
            <input
              ref={codeRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), reasonRef.current?.focus())}
              placeholder="รหัส"
              className="form-input font-mono"
            />
          </div>
          <input
            ref={reasonRef}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), save())}
            placeholder="สาเหตุที่ติด C"
            className="form-input"
          />
          <p className="text-xs text-ink/60">การแก้ไขจะถูกบันทึกลงประวัติของแถวนี้ (เก็บค่าเดิมไว้)</p>
          {error && <p className="text-sm text-rose">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
          <Button variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button
            variant="primary"
            onClick={save}
            disabled={saving || !reason.trim()}
          >
            {saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ---------- Modal: audit ตอบว่าแก้ไขอย่างไร (ทีละแถวรหัส) ---------- */
function ReplyForm({
  item,
  c,
  submission,
  onClose,
  onSaved,
}: {
  item: CodeCItem
  c: CodeCCase
  submission: string | null
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
    const { error } = await supabase.from('code_c_items').update({ fix_detail: fix.trim() }).eq('id', item.id)
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    onSaved()
  }

  const hist = item.code_c_history ?? []

  return (
    <div className="modal-overlay">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl border-t-8 border-brand bg-surface shadow-xl">
        <div className="flex items-center justify-between px-6 pt-5">
          <h2 className="text-base font-semibold text-ink">Audit — บันทึกการแก้ไข Code C</h2>
          <Button variant="icon" onClick={onClose}>
            ✕
          </Button>
        </div>
        <div className="space-y-4 overflow-y-auto px-6 py-4">
          <div className="rounded-lg bg-paper px-3 py-2 text-sm text-ink">
            <p>
              encounter_id <span className="font-mono font-semibold">{c.encounter_id}</span> ·{' '}
              {c.admissions?.patients?.full_name ?? '—'}
            </p>
            <p className="mt-1 font-semibold">{codeLabel(item)}</p>
            <p className="text-ink/80">
              <span className="font-semibold">สาเหตุ:</span> {item.reason}
            </p>
            <p className="text-xs text-ink/60">
              แจ้งโดย {item.added_by_email ?? '—'} · {fmtStamp(item.added_at)} · ส่งเบิก {fmtDate(submission)} · dateline{' '}
              {submission ? fmtDate(addDays(submission, DEADLINE_DAYS)) : '—'}
            </p>
          </div>
          {item.round_no > 1 && (
            <p className="rounded-lg bg-rose-soft/50 px-3 py-2 text-sm font-semibold text-rose">
              รอบที่ {item.round_no} — user แจ้งว่าการแก้ครั้งก่อนไม่ผ่าน ดูวิธีที่แก้ไปแล้วด้านล่างก่อนตอบ
            </p>
          )}
          {hist.some((h) => h.kind !== 'reason' || h.round_no > 1) && (
            <div>
              <p className="mb-1 text-sm font-medium text-ink/80">ประวัติการแก้ไขที่ผ่านมา</p>
              <div className="max-h-48 overflow-y-auto">
                <HistoryList item={item} skipCurrentAnswer />
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
              className="form-input resize-y"
              placeholder="เช่น แก้รหัส ICD-9 เป็น … แนบเอกสาร … แล้ว ส่งเบิกซ้ำ"
            />
          </div>
          {error && <p className="text-sm text-rose">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
          <Button variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button
            variant="primary"
            onClick={save}
            disabled={!fix.trim() || saving}
          >
            {saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ---------- Modal ยืนยัน: ผ่าน / ไม่ผ่านการแก้ C (รายแถวรหัส) ---------- */
function DecisionConfirm({
  mode,
  item,
  c,
  onClose,
  onDone,
}: {
  mode: 'pass' | 'reopen'
  item: CodeCItem
  c: CodeCCase
  onClose: () => void
  onDone: () => void
}) {
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isPass = mode === 'pass'

  async function confirm() {
    if (saving) return
    setSaving(true)
    setError(null)
    const { error } = isPass
      ? await supabase.rpc('code_c_pass', { p_item_id: item.id })
      : await supabase.rpc('code_c_reopen', { p_item_id: item.id, p_note: note.trim() || null })
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    onDone()
  }

  return (
    <div className="modal-overlay">
      <div className={'w-full max-w-md rounded-2xl border-t-8 bg-surface shadow-xl ' + (isPass ? 'border-brand' : 'border-rose')}>
        <div className="space-y-3 px-6 py-5">
          <h2 className="text-base font-semibold text-ink">ยืนยัน "{isPass ? 'ผ่านการแก้ C' : 'ไม่ผ่านการแก้ C'}" ?</h2>
          <p className="rounded-lg bg-paper px-3 py-2 text-sm text-ink">
            encounter_id <span className="font-mono font-semibold">{c.encounter_id}</span> ·{' '}
            {c.admissions?.patients?.full_name ?? '—'}
            <span className="mt-0.5 block font-semibold">{codeLabel(item)}</span>
          </p>
          {isPass ? (
            <p className="text-sm text-ink/80">
              รหัสนี้จะถูกปิดเป็น <span className="font-semibold">ผ่านแล้ว</span> และเป็นสถานะสุดท้าย Audit แก้คำตอบไม่ได้
              และกด "ไม่ผ่านการแก้ C" ย้อนกลับไม่ได้ (รหัสอื่นของเคสนี้ไม่ถูกแตะ)
            </p>
          ) : (
            <>
              <p className="text-sm text-ink/80">
                เฉพาะรหัสนี้จะกลับไปเป็น <span className="font-semibold">รอ Audit แก้ไข</span> (รอบที่ {item.round_no + 1}) และ
                dateline นับต่อจากวันส่งเบิกโดยไม่รีเซ็ต
              </p>
              <div>
                <label className="mb-1 block text-sm font-medium text-ink/80">เหตุผลที่ไม่ผ่าน (ไม่บังคับ)</label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  className="form-input resize-y"
                  placeholder="เช่น แก้แล้วยังติด C ด้วยเหตุผลเดิม"
                />
              </div>
            </>
          )}
          {error && <p className="text-sm text-rose">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
          <Button variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <button
            onClick={confirm}
            disabled={saving}
            className={
              'rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 ' +
              (isPass ? 'bg-brand text-ink hover:bg-brand-dark' : 'bg-rose text-white hover:opacity-90')
            }
          >
            {saving ? 'กำลังบันทึก…' : isPass ? 'ตกลง ผ่านแล้ว' : 'ตกลง ไม่ผ่าน'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------- หน้า Code C ---------- */
type StatusFilter = '' | 'open' | 'done' | 'passed'

interface Row {
  c: CodeCCase
  item: CodeCItem
  first: boolean
  span: number
}

export default function CodeCPage() {
  const { role, session } = useAuth()
  const myId = session?.user.id ?? ''
  const isAdmin = role === 'admin'
  const canReport = role === 'admin' || role === 'user'
  const canReply = role === 'admin' || role === 'audit'
  const canDecide = role === 'user' // developer ทดสอบผ่านโหมดจำลอง user
  // ปุ่ม "เฉพาะสิทธิของฉัน": เฉพาะ role ที่มีสิทธิ์ที่ดูแลของตัวเอง (My job) — audit / viewer ไม่มี จึงไม่แสดงปุ่ม
  const canFilterMine = role === 'admin' || role === 'user'

  const [cases, setCases] = useState<CodeCCase[]>([])
  const [myPairs, setMyPairs] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusFilter>('')
  const [onlyMine, setOnlyMine] = useState(false)
  const [search, setSearch] = useState('')
  const [formPreset, setFormPreset] = useState<Target | null | undefined>(undefined) // undefined = ปิด
  const [editing, setEditing] = useState<{ c: CodeCCase; item: CodeCItem } | null>(null)
  const [replying, setReplying] = useState<{ c: CodeCCase; item: CodeCItem } | null>(null)
  const [deciding, setDeciding] = useState<{ mode: 'pass' | 'reopen'; c: CodeCCase; item: CodeCItem } | null>(null)

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
  const subOf = (c: CodeCCase) => c.admissions?.case_tracking?.submission_date ?? null

  // แปลงเคสเป็นแถวรหัส (กรองตามค้นหา/สถานะ/สิทธิ)
  const rows = useMemo<Row[]>(() => {
    const q = search.trim().toLowerCase()
    const out: Row[] = []
    for (const c of cases) {
      if (canFilterMine && onlyMine && !myPairs.has(pairKey(c.admissions?.coverage_code, c.admissions?.payer_id))) continue
      const caseMatch =
        !q ||
        String(c.encounter_id).includes(q) ||
        (c.admissions?.patients?.full_name ?? '').toLowerCase().includes(q) ||
        (c.admissions?.hn ?? '').toLowerCase().includes(q)
      const items = [...(c.code_c_items ?? [])]
        .sort((a, b) => a.seq - b.seq)
        .filter((i) => {
          if (status === 'open' && i.status !== 'pending') return false
          if (status === 'done' && i.status !== 'answered') return false
          if (status === 'passed' && i.status !== 'passed') return false
          return caseMatch || (i.code ?? '').toLowerCase().includes(q)
        })
      items.forEach((item, idx) => out.push({ c, item, first: idx === 0, span: items.length }))
    }
    return out
  }, [cases, status, onlyMine, myPairs, search, canFilterMine])

  const allItems = cases.flatMap((c) => (c.code_c_items ?? []).map((item) => ({ c, item })))
  const openCount = allItems.filter(({ item }) => item.status === 'pending').length
  const overdueCount = allItems.filter(({ c, item }) => (calcDateline(item, subOf(c), today)?.overdue ?? 0) > 0).length

  async function removeItem(c: CodeCCase, item: CodeCItem) {
    const last = (c.code_c_items ?? []).length <= 1
    if (!window.confirm(`ลบรหัส ${codeLabel(item)} ของ encounter_id ${c.encounter_id} ?${last ? '\n(เป็นรหัสสุดท้าย เคสนี้จะถูกลบออกจากหน้า Code C ด้วย)' : ''}`)) return
    const { error } = last
      ? await supabase.from('code_c_cases').delete().eq('id', c.id)
      : await supabase.from('code_c_items').delete().eq('id', item.id)
    if (error) alert(`ลบไม่สำเร็จ: ${error.message}`)
    else load()
  }

  function addToCase(c: CodeCCase) {
    setFormPreset({
      admission_id: c.admission_id,
      encounter_id: c.encounter_id,
      name: c.admissions?.patients?.full_name ?? '—',
      line: `${c.admissions?.coverage_code ?? ''} ${c.admissions?.coverage_master?.coverage_name ?? ''} · ส่งเบิก ${fmtDate(subOf(c))}${
        c.admissions?.case_tracking?.claim_no ? ` · เลขที่ ${c.admissions.case_tracking.claim_no}` : ''
      }`,
    })
  }

  return (
    <main className="w-full space-y-5 px-4 py-6 sm:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">Code C — เคสติด C หลังส่งเบิก</h1>
          <p className="mt-1 text-sm text-ink/70">
            user แจ้งรหัสที่ติด C ทีละแถว (1 เคสมีได้หลายรหัส) → audit ตอบว่าแก้ไขอย่างไรทีละรหัส → user กด "ผ่านการแก้ C"
            เพื่อปิดรหัสนั้น (สถานะสุดท้าย) หรือ "ไม่ผ่านการแก้ C" เพื่อส่งกลับให้ audit แก้ซ้ำ · dateline นับจากวันที่ส่งเบิก + {DEADLINE_DAYS} วันให้เอง
          </p>
        </div>
        {canReport && (
          <button
            data-tour="codec-report"
            onClick={() => setFormPreset(null)}
            className="whitespace-nowrap rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-ink hover:bg-brand-dark"
          >
            + แจ้งเคสติด C
          </button>
        )}
      </div>

      <div data-tour="codec-stats" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: 'รหัสที่ติด C ทั้งหมด', value: allItems.length },
          { label: 'รหัสที่รอ Audit แก้ไข', value: openCount },
          { label: 'รหัสที่เกิน dateline', value: overdueCount },
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
          placeholder="ค้นหาชื่อ / encounter_id / HN / รหัส"
          className="form-input sm:max-w-xs"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="form-input w-auto">
          <option value="">ทุกสถานะ</option>
          <option value="open">รอ Audit แก้ไข</option>
          <option value="done">Audit ตอบแล้ว (รอ user ยืนยัน)</option>
          <option value="passed">ผ่านแล้ว</option>
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
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface p-8 text-center text-sm text-ink/50">
          ไม่มีรายการ Code C ที่ตรงเงื่อนไข
        </div>
      ) : (
        <div data-tour="codec-table" className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[1150px] text-left text-sm">
            <thead>
              <tr className="bg-brand text-[13px] text-ink">
                <th className="whitespace-nowrap px-3 py-3 font-semibold">encounter_id</th>
                <th className="px-3 py-3 font-semibold">ผู้ป่วย / สิทธิ</th>
                <th className="whitespace-nowrap px-3 py-3 font-semibold">ส่งเบิก</th>
                <th className="whitespace-nowrap px-3 py-3 font-semibold">รหัส</th>
                <th className="min-w-[12rem] px-3 py-3 font-semibold">สาเหตุที่ติด C (User)</th>
                <th className="whitespace-nowrap px-3 py-3 font-semibold">Dateline</th>
                <th className="min-w-[14rem] px-3 py-3 font-semibold">แก้ไขอย่างไร (Audit)</th>
                <th className="whitespace-nowrap px-3 py-3 font-semibold text-right">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, item, first, span }) => {
                const passed = item.status === 'passed'
                const done = item.status === 'answered' || passed
                const sub = subOf(c)
                const dl = calcDateline(item, sub, today)
                const overdue = (dl?.overdue ?? 0) > 0
                const history = sortedHistory(item)
                const hasPast = history.some((h) => h.kind !== 'reason' || h.round_no > 1 || h.prev_body)
                const topBorder = first ? 'border-t-2 border-t-ink/20' : ''
                return (
                  <tr key={item.id} className={'border-b border-line align-top hover:bg-paper ' + topBorder}>
                    {first && (
                      <>
                        <td
                          rowSpan={span}
                          className="whitespace-nowrap border-r border-line/60 px-3 py-2.5 font-mono text-[13px] font-semibold text-ink"
                        >
                          {c.encounter_id}
                          {canReport && (
                            <button
                              onClick={() => addToCase(c)}
                              className="mt-2 block rounded-md border border-ink/40 px-2 py-0.5 font-sans text-xs font-medium text-ink hover:bg-brand"
                            >
                              + เพิ่มรหัส
                            </button>
                          )}
                        </td>
                        <td rowSpan={span} className="min-w-[10rem] border-r border-line/60 px-3 py-2.5 text-ink">
                          <p>{c.admissions?.patients?.full_name ?? '—'}</p>
                          <p className="text-xs text-ink/70">
                            <span className="font-mono font-semibold">{c.admissions?.coverage_code}</span>{' '}
                            {c.admissions?.coverage_master?.coverage_name ?? ''}
                          </p>
                        </td>
                        <td rowSpan={span} className="whitespace-nowrap border-r border-line/60 px-3 py-2.5 text-ink">
                          {fmtDate(sub)}
                          {c.admissions?.case_tracking?.claim_no && (
                            <p className="text-xs text-ink/70">{c.admissions.case_tracking.claim_no}</p>
                          )}
                        </td>
                      </>
                    )}
                    <td className="whitespace-nowrap px-3 py-2.5 text-ink">
                      {item.code_type && (
                        <span className="mr-1.5 rounded-full border border-line px-2 py-0.5 text-xs font-medium">
                          {TYPE_LABEL[item.code_type]}
                        </span>
                      )}
                      <span className="font-mono text-[13px] font-semibold">{item.code ?? '—'}</span>
                    </td>
                    <td className="px-3 py-2.5 text-ink">
                      <p className="whitespace-pre-wrap break-words">{item.reason}</p>
                      <p className="mt-1 text-xs text-ink/60">
                        {item.added_by_email ?? '—'} · {fmtStamp(item.added_at)}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      {dl ? (
                        <>
                          <span
                            className={
                              'rounded-full px-2.5 py-0.5 text-xs font-semibold ' +
                              (overdue ? 'bg-rose-soft text-rose' : done ? 'bg-brand text-ink' : 'border border-line text-ink')
                            }
                          >
                            {fmtDate(dl.due)}
                          </span>
                          <p className={'mt-1 text-xs ' + (overdue ? 'font-semibold text-rose' : 'text-ink/70')}>
                            วันที่ {dl.elapsed} / {DEADLINE_DAYS}
                            {overdue ? ` · เกิน ${dl.overdue} วัน` : ''}
                            {dl.stopped ? ' (หยุดนับ)' : ''}
                          </p>
                        </>
                      ) : (
                        <span className="text-xs text-ink/50">ยังไม่มีวันส่งเบิก</span>
                      )}
                      {item.round_no > 1 && <p className="mt-1 text-xs font-semibold text-ink">รอบที่ {item.round_no}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-ink">
                      {done ? (
                        <>
                          <p className="whitespace-pre-wrap break-words">{item.fix_detail}</p>
                          <p className="mt-1 text-xs text-ink/60">
                            {item.fix_by_email ?? '—'} · {fmtStamp(item.fix_at)}
                          </p>
                          {passed && (
                            <p className="mt-2">
                              <span className="rounded-full bg-brand px-2.5 py-0.5 text-xs font-semibold text-ink">ผ่านแล้ว</span>
                              <span className="ml-1.5 text-xs text-ink/60">
                                {item.passed_by_email ?? '—'} · {fmtStamp(item.passed_at)}
                              </span>
                            </p>
                          )}
                        </>
                      ) : (
                        <span className="text-ink/45">
                          {item.round_no > 1 ? `รอ Audit แก้ไข (รอบที่ ${item.round_no})` : 'รอ Audit ตอบ'}
                        </span>
                      )}
                      {hasPast && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs font-semibold text-ink underline">
                            ประวัติการแก้ไข ({history.length})
                          </summary>
                          <div className="mt-2">
                            <HistoryList item={item} />
                          </div>
                        </details>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      <div className="flex justify-end gap-1.5">
                        {canReply && !passed && (
                          <button
                            data-tour="codec-reply"
                            onClick={() => setReplying({ c, item })}
                            className="rounded-md bg-brand px-3 py-1 text-sm font-semibold text-ink hover:bg-brand-dark"
                          >
                            {done ? 'แก้คำตอบ' : item.round_no > 1 ? `ตอบรอบที่ ${item.round_no}` : 'ตอบ'}
                          </button>
                        )}
                        {canDecide && item.status === 'answered' && (
                          <button
                            onClick={() => setDeciding({ mode: 'pass', c, item })}
                            className="rounded-md border border-ink bg-brand px-3 py-1 text-sm font-semibold text-ink hover:bg-brand-dark"
                          >
                            ผ่านการแก้ C
                          </button>
                        )}
                        {canDecide && item.status === 'answered' && (
                          <button
                            data-tour="codec-reopen"
                            onClick={() => setDeciding({ mode: 'reopen', c, item })}
                            className="rounded-md border border-rose/50 px-3 py-1 text-sm font-semibold text-rose hover:bg-rose-soft"
                          >
                            ไม่ผ่านการแก้ C
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            onClick={() => setEditing({ c, item })}
                            className="rounded-md border border-ink/40 px-3 py-1 text-sm font-medium text-ink hover:bg-brand"
                          >
                            แก้รหัส
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            onClick={() => removeItem(c, item)}
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

      {formPreset !== undefined && (
        <CodeCForm
          preset={formPreset}
          onClose={() => setFormPreset(undefined)}
          onSaved={() => {
            setFormPreset(undefined)
            load()
          }}
        />
      )}
      {editing && (
        <ItemEditForm
          item={editing.item}
          c={editing.c}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}
      {deciding && (
        <DecisionConfirm
          mode={deciding.mode}
          item={deciding.item}
          c={deciding.c}
          onClose={() => setDeciding(null)}
          onDone={() => {
            setDeciding(null)
            load()
          }}
        />
      )}
      {replying && (
        <ReplyForm
          item={replying.item}
          c={replying.c}
          submission={subOf(replying.c)}
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
