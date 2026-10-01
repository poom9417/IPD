import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import type { Admission, AdmissionDraft, CaseTrackingDraft, CoverageMaster, PayerMaster } from '../lib/types'

function toDraft(a: Admission | null): AdmissionDraft {
  if (!a) {
    return {
      encounter_id: '',
      an: '',
      hn: '',
      full_name: '',
      birthdate: '',
      admit_date: '',
      admit_time: '',
      discharge_date: '',
      discharge_time: '',
      division_code: '',
      los: '',
      coverage_code: 'UNK',
      payer_id: 'UNK',
    }
  }
  return {
    encounter_id: a.encounter_id,
    an: a.an,
    hn: a.hn,
    full_name: a.patients?.full_name ?? '',
    birthdate: a.patients?.birthdate ?? '',
    admit_date: a.admit_date,
    admit_time: a.admit_time ?? '',
    discharge_date: a.discharge_date ?? '',
    discharge_time: a.discharge_time ?? '',
    division_code: a.division_code ?? '',
    los: a.los ?? '',
    coverage_code: a.coverage_code || 'UNK',
    payer_id: a.payer_id || 'UNK',
  }
}

function toCaseDraft(a: Admission | null): CaseTrackingDraft {
  const ct = a?.case_tracking
  return {
    document_received_date: ct?.document_received_date ?? '',
    audit_date: ct?.audit_date ?? '',
    audit_amount: ct?.audit_amount != null ? String(ct.audit_amount) : '',
    submission_date: ct?.submission_date ?? '',
    submission_amount: ct?.submission_amount != null ? String(ct.submission_amount) : '',
    claim_no: ct?.claim_no ?? '',
  }
}

interface Props {
  admission: Admission | null
  coverageOptions: CoverageMaster[]
  payerOptions: PayerMaster[]
  onClose: () => void
  onSaved: () => void
}

export default function AdmissionForm({ admission, coverageOptions, payerOptions, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<AdmissionDraft>(toDraft(admission))
  const [caseDraft, setCaseDraft] = useState<CaseTrackingDraft>(toCaseDraft(admission))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isEdit = admission !== null
  const { role } = useAuth()

  // กด Esc เพื่อปิดหน้าต่าง
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  function set<K extends keyof AdmissionDraft>(key: K, value: AdmissionDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  function setCase<K extends keyof CaseTrackingDraft>(key: K, value: CaseTrackingDraft[K]) {
    setCaseDraft((d) => ({ ...d, [key]: value }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    try {
      // admin: เพิ่ม/แก้ข้อมูลผู้ป่วยได้  |  user: เพิ่ม HN ใหม่ได้อย่างเดียว (HN ที่มีอยู่แล้วจะไม่ถูกเขียนทับ)
      const { error: patientErr } = await supabase.from('patients').upsert(
        {
          hn: draft.hn.trim(),
          full_name: draft.full_name.trim(),
          birthdate: draft.birthdate || null,
        },
        role === 'admin' ? undefined : { onConflict: 'hn', ignoreDuplicates: true },
      )
      if (patientErr) throw patientErr

      const fields = {
        an: Number(draft.an),
        hn: draft.hn.trim(),
        admit_date: draft.admit_date,
        admit_time: draft.admit_time || null,
        discharge_date: draft.discharge_date || null,
        discharge_time: draft.discharge_time || null,
        division_code: draft.division_code || null,
        los: draft.los === '' ? null : Number(draft.los),
        coverage_code: draft.coverage_code || 'UNK',
        payer_id: draft.payer_id || 'UNK',
      }

      // 1 แถว = 1 encounter ต่อ 1 สิทธิ/ผู้จ่าย — แก้ไขด้วย admission_id, เพิ่มใหม่ด้วย insert
      let admissionId: number
      if (admission) {
        const { error: updErr } = await supabase
          .from('admissions')
          .update({ ...fields, updated_at: new Date().toISOString() })
          .eq('admission_id', admission.admission_id)
        if (updErr) throw updErr
        admissionId = admission.admission_id
      } else {
        const { data: ins, error: insErr } = await supabase
          .from('admissions')
          .insert({ encounter_id: Number(draft.encounter_id), ...fields })
          .select('admission_id')
          .single()
        if (insErr) throw insErr
        admissionId = ins.admission_id
      }

      // role user ห้ามบันทึกวัน/ยอด Audit (เป็นงานของ audit) — ฐานข้อมูลบล็อกซ้ำอีกชั้น
      const canAuditFields = role === 'admin'
      const hasCaseData =
        caseDraft.document_received_date ||
        (canAuditFields && (caseDraft.audit_date || caseDraft.audit_amount)) ||
        caseDraft.submission_date ||
        caseDraft.submission_amount ||
        caseDraft.claim_no

      if (hasCaseData) {
        const { error: caseErr } = await supabase.from('case_tracking').upsert(
          {
            admission_id: admissionId,
            encounter_id: Number(draft.encounter_id),
            document_received_date: caseDraft.document_received_date || null,
            ...(canAuditFields
              ? {
                  audit_date: caseDraft.audit_date || null,
                  audit_amount: caseDraft.audit_amount === '' ? null : Number(caseDraft.audit_amount),
                }
              : {}),
            submission_date: caseDraft.submission_date || null,
            submission_amount: caseDraft.submission_amount === '' ? null : Number(caseDraft.submission_amount),
            claim_no: caseDraft.claim_no || null,
          },
          { onConflict: 'admission_id' },
        )
        if (caseErr) throw caseErr
      }

      onSaved()
    } catch (err) {
      const e = err as { code?: string; message?: string }
      setError(
        e.code === '23505'
          ? 'มีแถวของ encounter นี้ที่ใช้สิทธิ + ผู้จ่ายเดียวกันอยู่แล้ว — เลือกสิทธิ/ผู้จ่ายอื่น หรือแก้แถวเดิม'
          : (e.message ?? 'บันทึกไม่สำเร็จ'),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <form
        onSubmit={handleSubmit}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col rounded-2xl bg-surface shadow-xl"
      >
        {/* หัวข้อ — อยู่กับที่ */}
        <div className="flex shrink-0 items-center justify-between px-6 pb-3 pt-5">
          <h2 className="text-base font-semibold text-ink">
            {isEdit ? 'แก้ไขเคส' : 'เพิ่มเคสใหม่'}
          </h2>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-lg leading-none text-ink hover:bg-brand">
            ✕
          </button>
        </div>

        {/* ฟอร์ม — เลื่อนขึ้นลงได้ด้วยลูกกลิ้งเมาส์ */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-6 py-1">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Encounter ID">
              <input
                required
                type="number"
                disabled={isEdit}
                value={draft.encounter_id}
                onChange={(e) => set('encounter_id', e.target.value === '' ? '' : Number(e.target.value))}
                className="input"
              />
            </Field>
            <Field label="AN">
              <input
                required
                type="number"
                value={draft.an}
                onChange={(e) => set('an', e.target.value === '' ? '' : Number(e.target.value))}
                className="input"
              />
            </Field>
          </div>

          <Field label="HN">
            <input required value={draft.hn} onChange={(e) => set('hn', e.target.value)} className="input" />
          </Field>

          <Field label="ชื่อผู้ป่วย">
            <input
              required
              value={draft.full_name}
              onChange={(e) => set('full_name', e.target.value)}
              className="input"
            />
          </Field>

          <Field label="วันเกิด">
            <input
              type="date"
              value={draft.birthdate}
              onChange={(e) => set('birthdate', e.target.value)}
              className="input"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="วันรับเข้า">
              <input
                required
                type="date"
                value={draft.admit_date}
                onChange={(e) => set('admit_date', e.target.value)}
                className="input"
              />
            </Field>
            <Field label="เวลารับเข้า">
              <input
                type="time"
                value={draft.admit_time}
                onChange={(e) => set('admit_time', e.target.value)}
                className="input"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="วันจำหน่าย">
              <input
                type="date"
                value={draft.discharge_date}
                onChange={(e) => set('discharge_date', e.target.value)}
                className="input"
              />
            </Field>
            <Field label="เวลาจำหน่าย">
              <input
                type="time"
                value={draft.discharge_time}
                onChange={(e) => set('discharge_time', e.target.value)}
                className="input"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="หอผู้ป่วย (division)">
              <input
                value={draft.division_code}
                onChange={(e) => set('division_code', e.target.value)}
                className="input"
              />
            </Field>
            <Field label="LOS (วัน)">
              <input
                type="number"
                value={draft.los}
                onChange={(e) => set('los', e.target.value === '' ? '' : Number(e.target.value))}
                className="input"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="สิทธิการรักษา">
              <select
                value={draft.coverage_code}
                onChange={(e) => set('coverage_code', e.target.value)}
                className="input"
              >
                {coverageOptions.map((c) => (
                  <option key={c.coverage_code} value={c.coverage_code}>
                    {c.coverage_code} — {c.coverage_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="ผู้จ่าย (payer)">
              <select value={draft.payer_id} onChange={(e) => set('payer_id', e.target.value)} className="input">
                {payerOptions.map((p) => (
                  <option key={p.payer_id} value={p.payer_id}>
                    {p.payer_id} — {p.payer_name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="border-t border-line pt-3">
            <p className="mb-2 text-sm font-semibold text-ink/80">สถานะเคลม</p>

            <Field label="วันที่รับเอกสาร">
              <input
                type="date"
                value={caseDraft.document_received_date}
                onChange={(e) => setCase('document_received_date', e.target.value)}
                className="input"
              />
            </Field>

            {role === 'admin' && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="วันที่ Audit">
                <input
                  type="date"
                  value={caseDraft.audit_date}
                  onChange={(e) => setCase('audit_date', e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="ยอด Audit (บาท)">
                <input
                  type="number"
                  step="0.01"
                  value={caseDraft.audit_amount}
                  onChange={(e) => setCase('audit_amount', e.target.value)}
                  className="input"
                />
              </Field>
            </div>
            )}

            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="วันที่ส่งเบิก">
                <input
                  type="date"
                  value={caseDraft.submission_date}
                  onChange={(e) => setCase('submission_date', e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="ยอดส่งเบิก (บาท)">
                <input
                  type="number"
                  step="0.01"
                  value={caseDraft.submission_amount}
                  onChange={(e) => setCase('submission_amount', e.target.value)}
                  className="input"
                />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="เลขที่ใบส่งเบิก (claim_no)">
                <input
                  type="text"
                  value={caseDraft.claim_no}
                  onChange={(e) => setCase('claim_no', e.target.value)}
                  className="input"
                />
              </Field>
            </div>
            <p className="mt-1.5 text-sm text-ink/60">สถานะเคลมเก็บแยกตามสิทธิ/ผู้จ่ายของแถวนี้ · 1 แถวส่งเบิกได้ครั้งเดียว — กรอกซ้ำจะแก้ไขค่าเดิม ไม่สร้างประวัติใหม่ · encounter ที่แยกสิทธิ ให้เพิ่มเคสใหม่ด้วย encounter_id เดิมแต่เลือกสิทธิอื่น</p>
          </div>
        </div>

        {/* ปุ่ม — ติดขอบล่างเสมอ ไม่ต้องเลื่อน */}
        <div className="shrink-0 border-t border-line px-6 py-3">
          {error && <p className="mb-2 text-sm text-rose">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-ink/40 px-4 py-2 text-sm font-medium text-ink hover:bg-brand-soft">
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-ink hover:bg-brand-dark disabled:opacity-50"
            >
              {saving ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink/80">{label}</span>
      {children}
    </label>
  )
}
