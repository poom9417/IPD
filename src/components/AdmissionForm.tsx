import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import type {
  Admission,
  AdmissionDraft,
  CaseTrackingDraft,
  CoverageMaster,
  DivisionMaster,
  Patient,
  PayerMaster,
} from '../lib/types'
import PatientSearchInput from './PatientSearchInput'
import CreatableSelect from './CreatableSelect'
import AddMasterPanel from './AddMasterPanel'

type AddingKind = 'coverage' | 'payer' | 'division'

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
    document_received_amount: ct?.document_received_amount != null ? String(ct.document_received_amount) : '',
    audit_date: ct?.audit_date ?? '',
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
  // ลบเคส — เฉพาะ admin ในโหมดแก้ไข (ฐานข้อมูลบล็อกซ้ำอีกชั้นด้วย RLS)
  const canDelete = isEdit && role === 'admin'
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // รายการหลักเก็บไว้ในฟอร์ม เพื่อให้รายการที่เพิ่งเพิ่มโผล่ทันที (Dashboard โหลดใหม่ตอนบันทึกเคส)
  const [coverages, setCoverages] = useState<CoverageMaster[]>(coverageOptions)
  const [payers, setPayers] = useState<PayerMaster[]>(payerOptions)
  const [divisions, setDivisions] = useState<DivisionMaster[]>([])
  const [adding, setAdding] = useState<{ kind: AddingKind; typed: string } | null>(null)
  // ผู้ป่วยเดิมที่เลือกจากการค้นหา — ถ้าไม่ใช่ admin จะล็อกชื่อ/วันเกิด (ระบบไม่เขียนทับข้อมูลผู้ป่วยเดิมอยู่แล้ว)
  const [pickedPatient, setPickedPatient] = useState<Patient | null>(null)
  const lockPatient = pickedPatient !== null && role !== 'admin'

  useEffect(() => {
    supabase
      .from('division_master')
      .select('division_code, division_name')
      .order('division_code')
      .then(({ data }) => setDivisions((data ?? []) as DivisionMaster[]))
  }, [])

  // กด Esc เพื่อปิดหน้าต่าง
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (confirmDelete) return // dialog ยืนยันการลบจัดการ Esc/Enter เอง
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving, confirmDelete])

  function set<K extends keyof AdmissionDraft>(key: K, value: AdmissionDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  function setCase<K extends keyof CaseTrackingDraft>(key: K, value: CaseTrackingDraft[K]) {
    setCaseDraft((d) => ({ ...d, [key]: value }))
  }

  function pickPatient(p: Patient) {
    setPickedPatient(p)
    setDraft((d) => ({ ...d, hn: p.hn, full_name: p.full_name, birthdate: p.birthdate ?? '' }))
  }

  function clearPatient() {
    setPickedPatient(null)
    setDraft((d) => ({ ...d, hn: '', full_name: '', birthdate: '' }))
  }

  // พิมพ์แก้ HN/ชื่อหลังเลือกแล้ว (เฉพาะ admin) = ถือว่าไม่ใช่ตัวเลือกเดิมอีกต่อไป
  function typePatient(key: 'hn' | 'full_name', v: string) {
    if (pickedPatient && v !== (key === 'hn' ? pickedPatient.hn : pickedPatient.full_name)) setPickedPatient(null)
    set(key, v)
  }

  const byCode = <T,>(get: (x: T) => string) => (a: T, b: T) => get(a).localeCompare(get(b))

  async function addCoverage(v: Record<string, string>): Promise<string | null> {
    const code = v.code.trim()
    const name = v.name.trim()
    const dup = coverages.find((c) => c.coverage_code.toLowerCase() === code.toLowerCase())
    if (dup) return `มีสิทธิ "${dup.coverage_code}" อยู่แล้ว — เลือกจากรายการได้เลย`
    const { error: err } = await supabase.from('coverage_master').insert({ coverage_code: code, coverage_name: name })
    if (err) return err.message
    setCoverages((l) => [...l, { coverage_code: code, coverage_name: name }].sort(byCode((c) => c.coverage_code)))
    set('coverage_code', code)
    setAdding(null)
    return null
  }

  async function addPayer(v: Record<string, string>): Promise<string | null> {
    const id = v.id.trim()
    const name = v.name.trim()
    const dup = payers.find((p) => p.payer_id === id)
    if (dup) return `มีผู้จ่ายเลข ${id} (${dup.payer_name}) อยู่แล้ว — เลือกจากรายการได้เลย`
    const { error: err } = await supabase.from('payer_master').insert({ payer_id: id, payer_name: name })
    if (err) return err.message
    setPayers((l) => [...l, { payer_id: id, payer_name: name }].sort(byCode((p) => p.payer_id)))
    set('payer_id', id)
    setAdding(null)
    return null
  }

  async function addDivision(v: Record<string, string>): Promise<string | null> {
    const code = v.code.trim()
    const name = v.name.trim() || null
    const dup = divisions.find((d) => d.division_code.toLowerCase() === code.toLowerCase())
    if (dup) return `มีหอผู้ป่วย "${dup.division_code}" อยู่แล้ว — เลือกจากรายการได้เลย`
    const { error: err } = await supabase.from('division_master').insert({ division_code: code, division_name: name })
    if (err) return err.message
    setDivisions((l) => [...l, { division_code: code, division_name: name }].sort(byCode((d) => d.division_code)))
    set('division_code', code)
    setAdding(null)
    return null
  }

  async function handleDelete() {
    if (!admission || deleting) return
    setDeleting(true)
    setError(null)
    // .select() เพื่อตรวจว่าถูกลบจริง — ถ้า RLS บล็อก Supabase จะไม่ error แต่คืน 0 แถว
    const { data, error: delErr } = await supabase
      .from('admissions')
      .delete()
      .eq('admission_id', admission.admission_id)
      .select('admission_id')
    setDeleting(false)
    setConfirmDelete(false)
    if (delErr) {
      setError(`ลบเคสไม่สำเร็จ: ${delErr.message}`)
      return
    }
    if (!data || data.length === 0) {
      setError('ลบเคสไม่สำเร็จ: ไม่พบเคสนี้ หรือคุณไม่มีสิทธิ์ลบ (เฉพาะ admin)')
      return
    }
    onSaved() // ปิดฟอร์ม + โหลดตารางใหม่
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

      // role user ห้ามบันทึกวัน Audit (เป็นงานของ audit) — ฐานข้อมูลบล็อกซ้ำอีกชั้น
      const canAuditFields = role === 'admin'
      const hasCaseData =
        caseDraft.document_received_date ||
        caseDraft.document_received_amount ||
        (canAuditFields && caseDraft.audit_date) ||
        caseDraft.submission_date ||
        caseDraft.submission_amount ||
        caseDraft.claim_no

      // ถ้าเคสนี้เคยมีแถว case_tracking อยู่แล้ว ต้องบันทึกต่อเสมอ แม้ช่องที่เหลือจะว่างหมด
      // (ไม่งั้นการลบค่าสุดท้ายออกจะไม่ถูกส่งไปที่ DB — ค่าเดิมจึงไม่หาย)
      const hadCaseRow = !!admission?.case_tracking
      if (hasCaseData || hadCaseRow) {
        const { error: caseErr } = await supabase.from('case_tracking').upsert(
          {
            admission_id: admissionId,
            encounter_id: Number(draft.encounter_id),
            document_received_date: caseDraft.document_received_date || null,
            document_received_amount:
              caseDraft.document_received_amount === '' ? null : Number(caseDraft.document_received_amount),
            ...(canAuditFields ? { audit_date: caseDraft.audit_date || null } : {}),
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

  const coverageSelectOptions = coverages.map((c) => ({
    value: c.coverage_code,
    label: `${c.coverage_code} — ${c.coverage_name}`,
  }))
  const payerSelectOptions = payers.map((p) => ({ value: p.payer_id, label: `${p.payer_id} — ${p.payer_name}` }))
  // หอผู้ป่วยของเคสที่แก้ไขอยู่ ต้องอยู่ในรายการเสมอ (กรณีรหัสเก่ายังไม่เข้า division_master)
  const divisionSelectOptions = [
    ...divisions.map((d) => ({
      value: d.division_code,
      label: d.division_name ? `${d.division_code} — ${d.division_name}` : d.division_code,
    })),
    ...(draft.division_code && !divisions.some((d) => d.division_code === draft.division_code)
      ? [{ value: draft.division_code, label: draft.division_code }]
      : []),
  ]

  return (
    <>
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

          {!isEdit && (
            <p className="rounded-lg bg-brand-soft/60 px-3 py-2 text-sm text-ink/70">
              พิมพ์ HN หรือชื่อผู้ป่วยช่องใดช่องหนึ่ง แล้วเลือกจากรายการ — ระบบจะเติมข้อมูลผู้ป่วยเดิมให้ทั้งหมด
            </p>
          )}

          <FieldBox label="HN">
            <PatientSearchInput
              field="hn"
              required
              value={draft.hn}
              onText={(v) => typePatient('hn', v)}
              onPick={pickPatient}
              disabled={lockPatient}
              searchEnabled={!isEdit}
            />
          </FieldBox>

          <FieldBox label="ชื่อผู้ป่วย">
            <PatientSearchInput
              field="name"
              required
              value={draft.full_name}
              onText={(v) => typePatient('full_name', v)}
              onPick={pickPatient}
              disabled={lockPatient}
              searchEnabled={!isEdit}
            />
          </FieldBox>

          {pickedPatient && (
            <div className="flex items-center justify-between rounded-lg border border-line bg-paper px-3 py-1.5 text-sm">
              <span className="text-ink/80">
                ✓ ผู้ป่วยเดิมในระบบ{lockPatient ? ' (ล็อกข้อมูลผู้ป่วย)' : ''}
              </span>
              <button type="button" onClick={clearPatient} className="font-medium text-ink underline">
                ล้างการเลือก
              </button>
            </div>
          )}

          <Field label="วันเกิด">
            <input
              type="date"
              value={draft.birthdate}
              disabled={lockPatient}
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
            <FieldBox label="หอผู้ป่วย (division)">
              <CreatableSelect
                value={draft.division_code}
                options={divisionSelectOptions}
                onChange={(v) => set('division_code', v)}
                onAddClick={(typed) => setAdding({ kind: 'division', typed })}
                addLabel="เพิ่มหอผู้ป่วยใหม่"
                emptyLabel="— ไม่ระบุ —"
              />
            </FieldBox>
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
            <FieldBox label="สิทธิการรักษา">
              <CreatableSelect
                value={draft.coverage_code}
                options={coverageSelectOptions}
                onChange={(v) => set('coverage_code', v)}
                onAddClick={(typed) => setAdding({ kind: 'coverage', typed })}
                addLabel="เพิ่มสิทธิใหม่"
              />
            </FieldBox>
            <FieldBox label="ผู้จ่าย (payer)">
              <CreatableSelect
                value={draft.payer_id}
                options={payerSelectOptions}
                onChange={(v) => set('payer_id', v)}
                onAddClick={(typed) => setAdding({ kind: 'payer', typed })}
                addLabel="เพิ่มผู้จ่ายใหม่"
              />
            </FieldBox>
          </div>

          {adding?.kind === 'coverage' && (
            <AddMasterPanel
              title="เพิ่มสิทธิการรักษาใหม่"
              fields={[
                { key: 'code', label: 'Coverage name (รหัสสิทธิ)', placeholder: 'เช่น GGO', required: true, mono: true },
                { key: 'name', label: 'ชื่อเต็ม', placeholder: 'เช่น ข้าราชการ', required: true },
              ]}
              initial={{ code: adding.typed }}
              onSubmit={addCoverage}
              onCancel={() => setAdding(null)}
            />
          )}
          {adding?.kind === 'payer' && (
            <AddMasterPanel
              title="เพิ่มผู้จ่ายใหม่"
              fields={[
                { key: 'id', label: 'เลข payer', placeholder: 'เช่น 50257', required: true, mono: true },
                { key: 'name', label: 'ชื่อผู้จ่าย', placeholder: 'เช่น กรมบัญชีกลาง', required: true },
              ]}
              initial={/^[0-9]+$/.test(adding.typed) ? { id: adding.typed } : { name: adding.typed }}
              onSubmit={addPayer}
              onCancel={() => setAdding(null)}
            />
          )}
          {adding?.kind === 'division' && (
            <AddMasterPanel
              title="เพิ่มหอผู้ป่วยใหม่"
              fields={[
                { key: 'code', label: 'รหัสหอผู้ป่วย', placeholder: 'เช่น CNIP5D', required: true, mono: true },
                { key: 'name', label: 'ชื่อเต็ม (ไม่บังคับ)', placeholder: 'เช่น หอผู้ป่วยใน 5D' },
              ]}
              initial={{ code: adding.typed }}
              onSubmit={addDivision}
              onCancel={() => setAdding(null)}
            />
          )}

          <div className="border-t border-line pt-3">
            <p className="mb-2 text-sm font-semibold text-ink/80">สถานะเคลม</p>

            <div className="grid grid-cols-2 gap-3">
              <Field label="วันที่รับเอกสาร">
                <input
                  type="date"
                  value={caseDraft.document_received_date}
                  onChange={(e) => setCase('document_received_date', e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="ยอด claim จาก HIS (บาท)">
                <input
                  type="number"
                  step="0.01"
                  value={caseDraft.document_received_amount}
                  onChange={(e) => setCase('document_received_amount', e.target.value)}
                  className="input"
                />
              </Field>
            </div>

            {role === 'admin' && (
            <div className="mt-3">
              <Field label="วันที่ Audit">
                <input
                  type="date"
                  value={caseDraft.audit_date}
                  onChange={(e) => setCase('audit_date', e.target.value)}
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
          <div className="flex items-center justify-between gap-2">
            {/* ซ้าย: ลบเคส (admin เท่านั้น) — แยกจากปุ่มบันทึก/ยกเลิก */}
            {canDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={saving || deleting}
                className="rounded-lg bg-alert px-4 py-2 text-sm font-semibold text-white hover:brightness-90 disabled:opacity-50"
              >
                ลบเคส
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
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
        </div>
      </form>
    </div>

    {confirmDelete && admission && (
      <ConfirmDeleteDialog
        admission={admission}
        deleting={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    )}
    </>
  )
}

// ยืนยันการลบเคสอีกครั้ง — Enter = ตกลง, Esc = ยกเลิก
function ConfirmDeleteDialog({
  admission,
  deleting,
  onConfirm,
  onCancel,
}: {
  admission: Admission
  deleting: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.repeat) return // กันกด Enter ค้างจากการเปิด dialog แล้วลบทันที
      if (e.key === 'Enter') {
        e.preventDefault()
        if (!deleting) onConfirm()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        if (!deleting) onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onConfirm, onCancel, deleting])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/50 p-4">
      <div role="alertdialog" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-xl">
        <h3 className="text-base font-semibold text-ink">ยืนยันการลบเคส</h3>
        <p className="mt-2 text-sm text-ink/80">
          ต้องการลบเคส <span className="font-mono font-semibold">encounter {admission.encounter_id}</span>
          {admission.patients?.full_name ? ` (${admission.patients.full_name})` : ''} ใช่หรือไม่?
        </p>
        <p className="mt-2 rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose">
          ข้อมูลสถานะเคลมและรายการ Code C ของเคสนี้จะถูกลบไปด้วย และกู้คืนไม่ได้
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="rounded-lg border border-ink/40 px-4 py-2 text-sm font-medium text-ink hover:bg-brand-soft disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            disabled={deleting}
            className="rounded-lg bg-alert px-4 py-2 text-sm font-semibold text-white hover:brightness-90 disabled:opacity-50"
          >
            {deleting ? 'กำลังลบ…' : 'ตกลง'}
          </button>
        </div>
      </div>
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

// เหมือน Field แต่ใช้ div แทน label — กันการคลิกในรายการ dropdown ไปกระตุ้นปุ่ม/ช่องอื่นใน label
function FieldBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block">
      <span className="mb-1 block text-sm font-medium text-ink/80">{label}</span>
      {children}
    </div>
  )
}
