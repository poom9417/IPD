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

function clean(v: string | undefined) {
  const s = (v ?? '').trim()
  return s === '' || s.toUpperCase() === 'NULL' ? null : s
}

export default function ImportAdmissionsCsv({ onClose, onDone }: Props) {
  const [rows, setRows] = useState<Row[]>([])
  const [fileName, setFileName] = useState('')
  const [missingCols, setMissingCols] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function handleFile(file: File) {
    setFileName(file.name)
    setResult(null)
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
    setResult(null)

    try {
      const coverageMap = new Map<string, string>()
      const payerMap = new Map<string, string>()
      const patientMap = new Map<string, { full_name: string; birthdate: string | null }>()
      const admissionRows: Record<string, string | number | null>[] = []

      for (const r of rows) {
        const hn = clean(r['HN'])
        const encounterId = clean(r['encounter_id'])
        if (!hn || !encounterId) continue

        const coverageCode = clean(r['coverage_code'])
        const coverageName = clean(r['coverage_name'])
        if (coverageCode && coverageName) coverageMap.set(coverageCode, coverageName)

        const payerId = clean(r['payer_id'])
        const payerName = clean(r['payer_name'])
        if (payerId && payerName) payerMap.set(payerId, payerName)

        patientMap.set(hn, {
          full_name: clean(r['name']) ?? '',
          birthdate: clean(r['birthdate']),
        })

        admissionRows.push({
          encounter_id: Number(encounterId),
          an: Number(clean(r['AN'])),
          hn,
          admit_date: clean(r['admit_date']),
          admit_time: clean(r['admited_time']),
          discharge_date: clean(r['discharge_date']),
          discharge_time: clean(r['discharge_time']),
          division_code: clean(r['division_code']),
          hospital_status_code: clean(r['status']) ? Number(clean(r['status'])) : null,
          los: clean(r['Los']) ? Number(clean(r['Los'])) : null,
          coverage_code: coverageCode,
          payer_id: payerId,
        })
      }

      if (coverageMap.size > 0) {
        const { error: e } = await supabase
          .from('coverage_master')
          .upsert(Array.from(coverageMap, ([coverage_code, coverage_name]) => ({ coverage_code, coverage_name })))
        if (e) throw e
      }

      if (payerMap.size > 0) {
        const { error: e } = await supabase
          .from('payer_master')
          .upsert(Array.from(payerMap, ([payer_id, payer_name]) => ({ payer_id, payer_name })))
        if (e) throw e
      }

      if (patientMap.size > 0) {
        const { error: e } = await supabase
          .from('patients')
          .upsert(Array.from(patientMap, ([hn, p]) => ({ hn, ...p })))
        if (e) throw e
      }

      const { error: admErr, count } = await supabase
        .from('admissions')
        .upsert(admissionRows, { onConflict: 'encounter_id', count: 'exact' })
      if (admErr) throw admErr

      setResult(`นำเข้าสำเร็จ ${count ?? admissionRows.length} เคส (ผู้ป่วย ${patientMap.size} คน)`)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'นำเข้าไม่สำเร็จ')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-surface p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">นำเข้าเคสใหม่จาก HIS (CSV)</h2>
          <button onClick={onClose} className="text-ink/40 hover:text-ink">
            ✕
          </button>
        </div>

        <p className="mb-2 text-[11px] text-ink/50">
          ต้องเป็นไฟล์รูปแบบเดียวกับตอนนำเข้าข้อมูลชุดแรก (คอลัมน์: {REQUIRED_COLS.join(', ')}) — encounter_id ที่มีอยู่แล้วจะถูกอัพเดตทับ ไม่สร้างซ้ำ
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

        {fileName && missingCols.length === 0 && rows.length > 0 && (
          <p className="mb-3 text-sm text-ink/70">พบ {rows.length} แถว พร้อมนำเข้า</p>
        )}

        {error && <p className="mb-3 text-sm text-rose">{error}</p>}
        {result && <p className="mb-3 text-sm text-teal-dark">{result}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm text-ink/70">
            ปิด
          </button>
          <button
            onClick={handleConfirm}
            disabled={rows.length === 0 || missingCols.length > 0 || uploading}
            className="rounded-lg bg-teal-dark px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {uploading ? 'กำลังนำเข้า…' : `นำเข้า ${rows.length} เคส`}
          </button>
        </div>
      </div>
    </div>
  )
}
