import { useState } from 'react'
import Papa from 'papaparse'
import { supabase } from '../lib/supabaseClient'

interface Props {
  onClose: () => void
  onDone: () => void
}

// คอลัมน์ตามไฟล์ export จาก HIS ต้นฉบับ (รูปแบบเดียวกับที่ใช้ตอน seed ข้อมูลชุดแรก)
const REQUIRED_COLS = [
  'HN',
  'AN',
  'encounter_id',
  'name',
  'admit_date',
  'admited_time',
  'discharge_date',
  'discharge_time',
  'division_code',
  'status',
  'Los',
  'birthdate',
  'coverage_code',
  'coverage_name',
  'payer_id',
  'payer_name',
]

interface Row {
  [key: string]: string
}

interface ImportSummary {
  rows_in_file: number
  invalid_skipped: number
  duplicate_in_file_skipped: number
  unk_placeholder_skipped: number
  unk_promoted_to_real_coverage: number
  new_patients: number
  new_coverages: number
  new_payers: number
  updated_coverages: number
  updated_payers: number
  new_divisions: number
  admissions_inserted: number
  admissions_updated: number
}

export default function ImportAdmissionsCsv({ onClose, onDone }: Props) {
  const [rows, setRows] = useState<Row[]>([])
  const [fileName, setFileName] = useState('')
  const [missingCols, setMissingCols] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  function handleFile(file: File) {
    setFileName(file.name)
    setSummary(null)
    setError(null)
    Papa.parse<Row>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (res) => {
        const headers = res.meta.fields ?? []
        const missing = REQUIRED_COLS.filter((c) => !headers.includes(c))
        setMissingCols(missing)
        setRows(res.data)
      },
    })
  }

  async function handleConfirm() {
    if (rows.length === 0 || missingCols.length > 0) return
    setUploading(true)
    setError(null)
    setSummary(null)

    try {
      // ทั้งหมดทำในฟังก์ชันฝั่งฐานข้อมูลรอบเดียว (transaction เดียว):
      // เพิ่ม HN / สิทธิ / ผู้จ่ายใหม่อัตโนมัติ, แปลง NULL เป็น UNK, ตัดแถวซ้ำ
      const { data, error: rpcErr } = await supabase.rpc('import_admissions', { rows })
      if (rpcErr) throw rpcErr
      setSummary(data as ImportSummary)
      onDone()
    } catch (err) {
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message
      setError(msg ?? 'นำเข้าไม่สำเร็จ')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-surface p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">นำเข้าเคสใหม่จาก HIS (CSV)</h2>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-lg leading-none text-ink hover:bg-brand">
            ✕
          </button>
        </div>

        <p className="mb-2 text-sm text-ink/70">
          ต้องเป็นไฟล์รูปแบบเดียวกับตอนนำเข้าข้อมูลชุดแรก (คอลัมน์: {REQUIRED_COLS.join(', ')}) — 1 แถว = 1 encounter ต่อ 1 สิทธิ/ผู้จ่าย
          (encounter เดียวกันแยกสิทธิได้) แถวที่ encounter + สิทธิ + ผู้จ่ายตรงกับที่มีอยู่แล้วจะถูกอัพเดตทับ ไม่สร้างซ้ำ
          สิทธิ/ผู้จ่ายที่เป็น NULL จะบันทึกเป็น UNK และ HN / สิทธิ / ผู้จ่ายใหม่จะถูกเพิ่มให้อัตโนมัติ
        </p>

        <input
          type="file"
          accept=".csv"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          className="input mb-3"
        />

        {fileName && missingCols.length > 0 && (
          <p className="mb-3 text-sm text-rose">ไฟล์นี้ขาดคอลัมน์: {missingCols.join(', ')}</p>
        )}

        {fileName && missingCols.length === 0 && rows.length > 0 && !summary && (
          <p className="mb-3 text-sm text-ink/70">พบ {rows.length} แถว พร้อมนำเข้า</p>
        )}

        {error && <p className="mb-3 text-sm text-rose">{error}</p>}

        {summary && (
          <div className="mb-3 rounded-lg bg-paper px-3 py-2 text-sm text-ink/80">
            <p className="font-medium text-ink font-semibold">
              นำเข้าสำเร็จ: เพิ่มใหม่ {summary.admissions_inserted} · อัพเดต {summary.admissions_updated} จาก {summary.rows_in_file} แถว
            </p>
            <ul className="mt-1 space-y-0.5 text-sm text-ink/70">
              <li>
                เพิ่มใหม่ — ผู้ป่วย {summary.new_patients} · สิทธิ {summary.new_coverages} · ผู้จ่าย {summary.new_payers} ·
                หอผู้ป่วย {summary.new_divisions ?? 0}
              </li>
              {((summary.updated_coverages ?? 0) > 0 || (summary.updated_payers ?? 0) > 0) && (
                <li>
                  อัพเดตชื่อตามไฟล์ล่าสุด — สิทธิ {summary.updated_coverages ?? 0} · ผู้จ่าย {summary.updated_payers ?? 0}
                </li>
              )}
              {summary.unk_promoted_to_real_coverage > 0 && (
                <li>เปลี่ยนแถว UNK เป็นสิทธิจริง {summary.unk_promoted_to_real_coverage} แถว</li>
              )}
              {summary.unk_placeholder_skipped > 0 && (
                <li>ข้ามแถว UNK ที่มีสิทธิจริงอยู่แล้ว {summary.unk_placeholder_skipped} แถว</li>
              )}
              {summary.duplicate_in_file_skipped > 0 && (
                <li>ข้ามแถวซ้ำในไฟล์ (encounter+สิทธิ+ผู้จ่ายเดียวกัน) {summary.duplicate_in_file_skipped} แถว</li>
              )}
              {summary.invalid_skipped > 0 && (
                <li className="text-rose">ข้ามแถวข้อมูลไม่ครบ (HN/AN/encounter_id/วันรับ) {summary.invalid_skipped} แถว</li>
              )}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-ink/40 px-4 py-2 text-sm font-medium text-ink hover:bg-brand-soft">
            ปิด
          </button>
          <button
            onClick={handleConfirm}
            disabled={rows.length === 0 || missingCols.length > 0 || uploading || !!summary}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-ink hover:bg-brand-dark disabled:opacity-50"
          >
            {uploading ? 'กำลังนำเข้า…' : `นำเข้า ${rows.length} แถว`}
          </button>
        </div>
      </div>
    </div>
  )
}
