import { useEffect, useState, type FormEvent } from 'react'
import type { Admission } from '../lib/types'
import Button from './ui/Button'

interface Props {
  admission: Admission
  onClose: () => void
  /** บันทึกวันที่รับเอกสาร + ยอด — คืน true เมื่อสำเร็จ (หน้าต่างจะปิดเอง) */
  onSave: (a: Admission, date: string, amount: number) => Promise<boolean>
}

/**
 * หน้าต่างแก้ไข "วันที่รับเอกสาร" และ "ยอด claim จาก HIS" ของเคสที่รับเอกสารไปแล้ว
 * ใช้ได้กับ role admin และ user — แก้เฉพาะ 2 ช่องนี้ ไม่แตะฟิลด์อื่น
 */
export default function ReceiveEditModal({ admission: a, onClose, onSave }: Props) {
  const ct = a.case_tracking
  const [date, setDate] = useState(ct?.document_received_date?.slice(0, 10) ?? '')
  const [amount, setAmount] = useState(ct?.document_received_amount != null ? String(ct.document_received_amount) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const amountNum = Number(amount)
  const amountValid = amount.trim() !== '' && Number.isFinite(amountNum) && amountNum >= 0
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date)
  const changed =
    date !== (ct?.document_received_date?.slice(0, 10) ?? '') ||
    (amountValid && amountNum !== (ct?.document_received_amount ?? null))

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    if (!dateValid) return setError('กรุณาเลือกวันที่รับเอกสาร')
    if (!amountValid) return setError('กรุณากรอกยอดเป็นตัวเลข (ไม่ติดลบ)')
    setError(null)
    setSaving(true)
    try {
      const ok = await onSave(a, date, amountNum)
      if (ok) onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay p-4">
      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-sm flex-col rounded-2xl bg-surface shadow-xl"
      >
        <div className="flex shrink-0 items-center justify-between px-6 pb-3 pt-5">
          <div>
            <h2 className="text-base font-semibold text-ink">แก้ไขการรับเอกสาร</h2>
            <p className="mt-0.5 text-sm text-ink/60">
              <span className="font-mono">{a.encounter_id}</span> · {a.patients?.full_name ?? a.hn}
            </p>
          </div>
          <Button
            variant="icon"
            type="button"
            onClick={onClose}
            disabled={saving}
          >
            ✕
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-6 py-1">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink/80">วันที่รับเอกสาร</span>
            <input
              autoFocus
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="form-input"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink/80">ยอด claim จาก HIS (บาท)</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="form-input"
            />
          </label>
          <p className="pb-1 text-sm text-ink/60">
            แก้ได้เฉพาะวันที่และยอดรับเอกสาร — ระบบจะบันทึกว่าใครแก้ไขล่าสุดและเมื่อไร
          </p>
        </div>

        <div className="shrink-0 border-t border-line px-6 py-3">
          {error && <p className="mb-2 text-sm text-rose">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              type="button"
              onClick={onClose}
              disabled={saving}
            >
              ยกเลิก
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={saving || !changed}
            >
              {saving ? 'กำลังบันทึก…' : 'บันทึก'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}
