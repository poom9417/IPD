import { useState } from 'react'
import Papa from 'papaparse'
import { supabase } from '../lib/supabaseClient'
import type { Admission, BulkStage } from '../lib/types'

interface Props {
  admissions: Admission[]
  onClose: () => void
  onDone: () => void
}

const STAGE_CONFIG: Record<
  BulkStage,
  { label: string; dateCol: string; amountCol?: string; needsPayerCheck?: boolean; example: string }
> = {
  document: {
    label: 'รับเอกสาร',
    dateCol: 'document_received_date',
    example:
      'encounter_id,document_received_date\n3043836,2026-09-24\n\n(ถ้า encounter แยกหลายสิทธิ เพิ่มคอลัมน์ payer_id เพื่อระบุแถว — ถ้าไม่ใส่จะลงทุกสิทธิของ encounter นั้น)',
  },
  audit: {
    label: 'Audit',
    dateCol: 'audit_date',
    amountCol: 'audit_amount',
    example:
      'encounter_id,audit_date,audit_amount\n3043836,2026-09-25,12500.50\n\n(ถ้า encounter แยกหลายสิทธิ เพิ่มคอลัมน์ payer_id เพื่อระบุแถว — ถ้าไม่ใส่จะลงทุกสิทธิของ encounter นั้น)',
  },
  submission: {
    label: 'ส่งเบิก',
    dateCol: 'submission_date',
    amountCol: 'submission_amount',
    needsPayerCheck: true,
    example:
      'encounter_id,payer_id,claim_no,submission_date,submission_amount\n3043836,50257,CLM-2026-0912,2026-09-26,12500.50',
  },
}

interface Target {
  admission_id: number
  encounter_id: number
}

interface ParsedRow {
  encounter_id: number
  targets: Target[]
  date: string
  amount?: number
  payerId?: string
  claimNo?: string
  raw: Record<string, string>
  error?: string
}

export default function BulkClaimUpload({ admissions, onClose, onDone }: Props) {
  const [stage, setStage] = useState<BulkStage>('audit')
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [fileName, setFileName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const cfg = STAGE_CONFIG[stage]
  // 1 encounter อาจมีหลายแถว (แยกสิทธิ/ผู้จ่าย)
  const byEncounter = new Map<number, Admission[]>()
  for (const a of admissions) {
    const list = byEncounter.get(a.encounter_id) ?? []
    list.push(a)
    byEncounter.set(a.encounter_id, list)
  }

  function handleFile(file: File) {
    setFileName(file.name)
    setResult(null)
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const parsed: ParsedRow[] = res.data.map((r) => {
          const encId = Number(r['encounter_id']?.trim())
          const date = r[cfg.dateCol]?.trim() ?? ''
          const amountRaw = cfg.amountCol ? r[cfg.amountCol]?.trim() : undefined
          // ขั้นส่งเบิกต้องมี payer_id ตรงกัน / ขั้นอื่นใส่ payer_id เพื่อระบุแถวก็ได้ (ไม่ใส่ = ทุกสิทธิของ encounter)
          const payerId = r['payer_id']?.trim() || undefined
          const claimNo = cfg.needsPayerCheck ? r['claim_no']?.trim() : undefined

          let error: string | undefined
          let targets: Target[] = []
          const candidates = byEncounter.get(encId) ?? []

          if (!encId) {
            error = 'encounter_id ไม่ถูกต้อง'
          } else if (!date) {
            error = `ไม่พบคอลัมน์ ${cfg.dateCol}`
          } else if (candidates.length === 0) {
            error = 'ไม่พบ encounter_id นี้ในระบบ'
          } else if (payerId) {
            targets = candidates
              .filter((a) => (a.payer_id ?? '').trim().toLowerCase() === payerId.toLowerCase())
              .map((a) => ({ admission_id: a.admission_id, encounter_id: a.encounter_id }))
            if (targets.length === 0) {
              const sys = candidates.map((a) => a.payer_id || '—').join(', ')
              error = `payer ไม่ตรงกับระบบ (ระบบ: ${sys}, ไฟล์: ${payerId})`
            }
          } else if (cfg.needsPayerCheck && candidates.length > 1) {
            error = 'encounter นี้แยกหลายสิทธิ ต้องระบุ payer_id'
          } else {
            targets = candidates.map((a) => ({ admission_id: a.admission_id, encounter_id: a.encounter_id }))
          }

          return {
            encounter_id: encId,
            targets,
            date,
            amount: amountRaw ? Number(amountRaw) : undefined,
            payerId,
            claimNo,
            raw: r,
            error,
          }
        })
        setRows(parsed)
      },
    })
  }

  async function handleConfirm() {
    const valid = rows.filter((r) => !r.error)
    if (valid.length === 0) return
    setUploading(true)
    setResult(null)

    // 1 แถวในไฟล์ อาจลงได้หลายแถวในระบบ (ทุกสิทธิของ encounter) — คีย์คือ admission_id
    const payload = valid.flatMap((r) =>
      r.targets.map((t) => {
        const base: Record<string, string | number | null> = {
          admission_id: t.admission_id,
          encounter_id: t.encounter_id,
        }
        base[cfg.dateCol] = r.date
        if (cfg.amountCol) base[cfg.amountCol] = r.amount ?? null
        if (cfg.needsPayerCheck) base.claim_no = r.claimNo || null
        return base
      }),
    )

    const { error, count } = await supabase
      .from('case_tracking')
      .upsert(payload, { onConflict: 'admission_id', count: 'exact' })

    setUploading(false)
    if (error) {
      setResult(`เกิดข้อผิดพลาด: ${error.message}`)
    } else {
      setResult(`บันทึกสำเร็จ ${count ?? payload.length} รายการ (แถวสิทธิ)`)
      onDone()
    }
  }

  const validCount = rows.filter((r) => !r.error).length
  const errorCount = rows.length - validCount

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4">
      <div className="w-full max-w-xl rounded-2xl bg-surface p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">อัพโหลดสถานะเคลมแบบ Bulk (CSV)</h2>
          <button onClick={onClose} className="text-ink/40 hover:text-ink">
            ✕
          </button>
        </div>

        <label className="mb-1 block text-xs font-medium text-ink/60">ขั้นตอนที่จะอัพเดต</label>
        <select
          value={stage}
          onChange={(e) => {
            setStage(e.target.value as BulkStage)
            setRows([])
            setFileName('')
            setResult(null)
          }}
          className="input mb-3"
        >
          {(Object.keys(STAGE_CONFIG) as BulkStage[]).map((s) => (
            <option key={s} value={s}>
              {STAGE_CONFIG[s].label}
            </option>
          ))}
        </select>

        <p className="mb-2 whitespace-pre-wrap rounded-lg bg-paper px-3 py-2 font-mono text-xs text-ink/60">{cfg.example}</p>
        {cfg.needsPayerCheck && (
          <p className="mb-2 text-xs text-ink/50">
            ระบบจะเช็ค payer_id ในไฟล์กับ payer ที่บันทึกไว้ของ encounter นั้น ถ้าไม่ตรงจะไม่บันทึกแถวนั้น (กันแมพผิดเคส) — ถ้า encounter แยกหลายสิทธิ ต้องระบุ payer_id
          </p>
        )}

        <input
          type="file"
          accept=".csv"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          className="input mb-3"
        />

        {fileName && rows.length > 0 && (
          <div className="mb-3 max-h-48 overflow-y-auto rounded-lg border border-line text-xs">
            <table className="w-full text-left">
              <thead className="bg-paper text-ink/50">
                <tr>
                  <th className="px-2 py-1.5">encounter_id</th>
                  <th className="px-2 py-1.5">วันที่</th>
                  {cfg.amountCol && <th className="px-2 py-1.5">จำนวนเงิน</th>}
                  {cfg.needsPayerCheck && <th className="px-2 py-1.5">claim_no</th>}
                  <th className="px-2 py-1.5">ลงกี่สิทธิ</th>
                  <th className="px-2 py-1.5">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-2 py-1.5">{r.encounter_id || '—'}</td>
                    <td className="px-2 py-1.5">{r.date || '—'}</td>
                    {cfg.amountCol && <td className="px-2 py-1.5">{r.amount ?? '—'}</td>}
                    {cfg.needsPayerCheck && <td className="px-2 py-1.5">{r.claimNo || '—'}</td>}
                    <td className="px-2 py-1.5">{r.error ? '—' : r.targets.length}</td>
                    <td className="px-2 py-1.5">
                      {r.error ? <span className="text-rose">{r.error}</span> : <span className="text-ink font-semibold">พร้อมบันทึก</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rows.length > 0 && (
          <p className="mb-3 text-xs text-ink/60">
            พร้อมบันทึก {validCount} แถว{errorCount > 0 && <span className="text-rose"> · ผิดพลาด {errorCount} แถว</span>}
          </p>
        )}

        {result && <p className="mb-3 text-sm text-ink">{result}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm text-ink/70">
            ปิด
          </button>
          <button
            onClick={handleConfirm}
            disabled={validCount === 0 || uploading}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-ink hover:bg-brand-dark disabled:opacity-50"
          >
            {uploading ? 'กำลังบันทึก…' : `บันทึก ${validCount} เคส`}
          </button>
        </div>
      </div>
    </div>
  )
}
