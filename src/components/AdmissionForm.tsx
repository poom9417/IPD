import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { Admission, AdmissionDraft, CoverageMaster, PayerMaster } from '../lib/types'

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
      coverage_code: '',
      payer_id: '',
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
    coverage_code: a.coverage_code ?? '',
    payer_id: a.payer_id ?? '',
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
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isEdit = admission !== null

  function set<K extends keyof AdmissionDraft>(key: K, value: AdmissionDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    try {
      const { error: patientErr } = await supabase.from('patients').upsert({
        hn: draft.hn.trim(),
        full_name: draft.full_name.trim(),
        birthdate: draft.birthdate || null,
      })
      if (patientErr) throw patientErr

      const { error: admissionErr } = await supabase.from('admissions').upsert({
        encounter_id: Number(draft.encounter_id),
        an: Number(draft.an),
        hn: draft.hn.trim(),
        admit_date: draft.admit_date,
        admit_time: draft.admit_time || null,
        discharge_date: draft.discharge_date || null,
        discharge_time: draft.discharge_time || null,
        division_code: draft.division_code || null,
        los: draft.los === '' ? null : Number(draft.los),
        coverage_code: draft.coverage_code || null,
        payer_id: draft.payer_id || null,
      })
      if (admissionErr) throw admissionErr

      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-surface p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">
            {isEdit ? 'แก้ไขเคส' : 'เพิ่มเคสใหม่'}
          </h2>
          <button onClick={onClose} className="text-ink/40 hover:text-ink">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
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
                <option value="">— ไม่ระบุ —</option>
                {coverageOptions.map((c) => (
                  <option key={c.coverage_code} value={c.coverage_code}>
                    {c.coverage_code} — {c.coverage_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="ผู้จ่าย (payer)">
              <select value={draft.payer_id} onChange={(e) => set('payer_id', e.target.value)} className="input">
                <option value="">— ไม่ระบุ —</option>
                {payerOptions.map((p) => (
                  <option key={p.payer_id} value={p.payer_id}>
                    {p.payer_id} — {p.payer_name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {error && <p className="text-sm text-rose">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm text-ink/70">
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-teal-dark px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink/60">{label}</span>
      {children}
    </label>
  )
}
