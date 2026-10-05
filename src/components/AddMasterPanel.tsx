import { useState } from 'react'

export interface MasterField {
  key: string
  label: string
  placeholder?: string
  required?: boolean
  mono?: boolean
}

interface Props {
  title: string
  fields: MasterField[]
  initial?: Record<string, string>
  /** คืนข้อความ error ถ้าไม่สำเร็จ, คืน null ถ้าสำเร็จ */
  onSubmit: (values: Record<string, string>) => Promise<string | null>
  onCancel: () => void
}

// กล่องเพิ่มข้อมูลหลักแบบแทรกในฟอร์ม (กด Enter ในกล่องนี้ = เพิ่มรายการ ไม่ใช่บันทึกเคส)
export default function AddMasterPanel({ title, fields, initial, onSubmit, onCancel }: Props) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, initial?.[f.key] ?? ''])),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const missing = fields.find((f) => f.required && !values[f.key].trim())
    if (missing) {
      setError(`กรอก "${missing.label}" ก่อน`)
      return
    }
    setBusy(true)
    setError(null)
    const err = await onSubmit(values)
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <div className="rounded-xl border border-brand-dark bg-brand-soft/60 p-3">
      <p className="mb-2 text-sm font-semibold text-ink">{title}</p>
      <div className="grid grid-cols-2 gap-3">
        {fields.map((f, i) => (
          <div key={f.key}>
            <span className="mb-1 block text-sm font-medium text-ink/80">
              {f.label}
              {f.required && <span className="text-rose"> *</span>}
            </span>
            <input
              autoFocus={i === 0}
              value={values[f.key]}
              placeholder={f.placeholder}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.stopPropagation()
                  submit()
                } else if (e.key === 'Escape') {
                  e.stopPropagation()
                  onCancel()
                }
              }}
              className={`input ${f.mono ? 'font-mono' : ''}`}
            />
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-rose">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-ink/40 px-3 py-1.5 text-sm font-medium text-ink hover:bg-brand-soft"
        >
          ยกเลิก
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-ink hover:bg-brand-dark disabled:opacity-50"
        >
          {busy ? 'กำลังเพิ่ม…' : 'เพิ่มรายการ'}
        </button>
      </div>
    </div>
  )
}
