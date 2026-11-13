import { useState, type KeyboardEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchCaseTracking } from '../lib/caseTracking'
import type { Admission } from '../lib/types'
import Button from './ui/Button'

const NOTE_MAX = 300
const REASON_MAX = 200

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
}

type Ct = Admission['case_tracking']

interface Props {
  admission: Admission
  /** true = admin / user แก้ได้ (ฐานข้อมูลบังคับสิทธิ์ซ้ำอีกชั้น) — false = ดูอย่างเดียว */
  editable: boolean
  /** แจ้งหน้าแม่ให้รีเฟรชเคสหลังบันทึก/ยกเลิกสำเร็จ */
  onChanged?: (ct: Ct) => void
}

/**
 * 2 ส่วนแยกกันชัดเจน (ใช้ทั้งในหน้าต่าง "แก้ไขเคส" และ "รายละเอียดเคส"):
 *  1) Note — บันทึกสั้นๆ ไว้อ่านเอง (บันทึกผู้เขียน + เวลา)
 *  2) ไม่ส่งเบิก — ใส่สาเหตุสั้นๆ แล้วเคสนี้จะไม่ถูกนับเป็นค้างเบิก (กดยกเลิกสถานะได้)
 * ทุกปุ่มเป็น type="button" และกัน Enter ไม่ให้ไป submit ฟอร์มแก้ไขเคสที่ครอบอยู่
 */
export default function CaseNotePanel({ admission, editable, onChanged }: Props) {
  const [ct, setCt] = useState<Ct>(admission.case_tracking)
  const [noteDraft, setNoteDraft] = useState(admission.case_tracking?.note ?? '')
  const [asking, setAsking] = useState(false)
  const [reasonDraft, setReasonDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const savedNote = ct?.note ?? ''
  const noteChanged = noteDraft.trim() !== savedNote
  const noClaim = ct?.no_claim === true
  const alreadySubmitted = !!ct?.submission_date

  async function act(action: () => PromiseLike<{ error: { message?: string } | null }>): Promise<boolean> {
    setBusy(true)
    setErr(null)
    try {
      const { error } = await action()
      if (error) throw error
      const data = await fetchCaseTracking(admission.admission_id)
      setCt(data)
      setNoteDraft(data?.note ?? '')
      onChanged?.(data)
      return true
    } catch (e) {
      setErr((e as { message?: string })?.message ?? 'บันทึกไม่สำเร็จ')
      return false
    } finally {
      setBusy(false)
    }
  }

  const saveNote = () =>
    act(() => supabase.rpc('set_case_note', { p_admission_id: admission.admission_id, p_note: noteDraft }))

  const deleteNote = () =>
    act(() => supabase.rpc('set_case_note', { p_admission_id: admission.admission_id, p_note: '' }))

  async function confirmNoClaim() {
    if (!reasonDraft.trim()) {
      setErr('ต้องระบุสาเหตุที่ไม่ส่งเบิก')
      return
    }
    const ok = await act(() =>
      supabase.rpc('set_no_claim', { p_admission_id: admission.admission_id, p_reason: reasonDraft }),
    )
    if (ok) {
      setAsking(false)
      setReasonDraft('')
    }
  }

  const cancelNoClaim = () => act(() => supabase.rpc('clear_no_claim', { p_admission_id: admission.admission_id }))

  function enterTo(fn: () => void) {
    return (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== 'Enter') return
      e.preventDefault() // ไม่ให้ Enter ไป submit ฟอร์มแก้ไขเคส
      if (!busy && !e.nativeEvent.isComposing) fn()
    }
  }

  // โหมดดูอย่างเดียว: แสดงเฉพาะส่วนที่มีข้อมูล
  if (!editable && !savedNote && !noClaim) return null

  return (
    <div className="space-y-4 border-t border-line pt-3">
      {/* ---------- 1) Note ---------- */}
      {(editable || savedNote) && (
        <div>
          <p className="mb-1 text-sm font-semibold text-ink/80">Note</p>
          {editable ? (
            <>
              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={NOTE_MAX}
                  value={noteDraft}
                  disabled={busy}
                  placeholder="จดสั้นๆ ไว้อ่านเอง"
                  onChange={(e) => setNoteDraft(e.target.value)}
                  onKeyDown={enterTo(() => {
                    if (noteChanged) void saveNote()
                  })}
                  className="form-input"
                />
                <Button
                  variant="outline"
                  type="button"
                  className="shrink-0 whitespace-nowrap"
                  disabled={busy || !noteChanged}
                  onClick={() => void saveNote()}
                >
                  บันทึก Note
                </Button>
              </div>
              {savedNote && (
                <div className="mt-1.5 flex items-center justify-between gap-2 text-sm text-ink/60">
                  <span>
                    บันทึกโดย {ct?.note_by_email ?? '—'} · {fmtDateTime(ct?.note_at)}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void deleteNote()}
                    className="shrink-0 font-medium text-ink underline disabled:opacity-50"
                  >
                    ลบ Note
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="break-words rounded-lg border border-line bg-paper px-3 py-2 text-[0.9375rem] text-ink">
                {savedNote}
              </div>
              <p className="mt-1.5 text-sm text-ink/60">
                บันทึกโดย {ct?.note_by_email ?? '—'} · {fmtDateTime(ct?.note_at)}
              </p>
            </>
          )}
        </div>
      )}

      {/* ---------- 2) ไม่ส่งเบิก ---------- */}
      {(editable || noClaim) && (
        <div>
          <p className="mb-1 text-sm font-semibold text-ink/80">ไม่ส่งเบิก</p>

          {noClaim ? (
            <div className="rounded-lg border border-line bg-brand-soft/60 px-3 py-2">
              <p className="text-sm font-semibold text-ink">เคสนี้ตั้งเป็น "ไม่ส่งเบิก" — ไม่นับเป็นค้างเบิก</p>
              <p className="mt-1 break-words text-[0.9375rem] text-ink">สาเหตุ: {ct?.no_claim_reason ?? '—'}</p>
              <p className="mt-1 text-sm text-ink/60">
                ตั้งโดย {ct?.no_claim_by_email ?? '—'} · {fmtDateTime(ct?.no_claim_at)}
              </p>
              {editable && (
                <div className="mt-2 flex justify-end">
                  <Button variant="outline" type="button" disabled={busy} onClick={() => void cancelNoClaim()}>
                    ยกเลิกสถานะไม่ส่งเบิก
                  </Button>
                </div>
              )}
            </div>
          ) : alreadySubmitted ? (
            <p className="text-sm text-ink/60">เคสนี้ส่งเบิกแล้ว จึงตั้งเป็น "ไม่ส่งเบิก" ไม่ได้</p>
          ) : asking ? (
            <div className="space-y-2">
              <input
                type="text"
                autoFocus
                maxLength={REASON_MAX}
                value={reasonDraft}
                disabled={busy}
                placeholder="สาเหตุที่ไม่ส่งเบิก (สั้นๆ)"
                onChange={(e) => setReasonDraft(e.target.value)}
                onKeyDown={enterTo(() => void confirmNoClaim())}
                className="form-input"
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setAsking(false)
                    setReasonDraft('')
                    setErr(null)
                  }}
                >
                  ยกเลิก
                </Button>
                <Button
                  variant="primary"
                  type="button"
                  disabled={busy || !reasonDraft.trim()}
                  onClick={() => void confirmNoClaim()}
                >
                  ยืนยันไม่ส่งเบิก
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-ink/60">เบิกไม่ได้ / ไม่ต้องส่งเบิก → เคสนี้จะไม่ถูกนับเป็นค้างเบิก</p>
              <Button variant="outline" type="button" className="shrink-0 whitespace-nowrap" onClick={() => setAsking(true)}>
                ไม่ส่งเบิก
              </Button>
            </div>
          )}
        </div>
      )}

      {err && <p className="text-sm text-rose">{err}</p>}
    </div>
  )
}
