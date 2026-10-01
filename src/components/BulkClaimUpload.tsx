import { useState } from 'react'
import Papa from 'papaparse'
import { supabase } from '../lib/supabaseClient'
import type { Admission, BulkStage } from '../lib/types'
import { parseGgoClaimFile } from '../lib/ggoClaimFile'

interface Props {
  admissions: Admission[]
  onClose: () => void
  onDone: () => void
  /** จำกัดขั้นตอนที่เลือกได้ (เช่น role audit → ['audit']) ไม่ใส่ = ทุกขั้นตอน */
  allowedStages?: BulkStage[]
}

const STAGE_CONFIG: Record<
  BulkStage,
  {
    label: string
    dateCol: string
    amountCol?: string
    /** ต้องมียอดทุกแถว (ไม่เว้นว่าง) */
    amountRequired?: boolean
    needsPayerCheck?: boolean
    example: string
  }
> = {
  document: {
    label: 'รับเอกสาร',
    dateCol: 'document_received_date',
    amountCol: 'document_received_amount',
    amountRequired: true,
    example:
      'encounter_id,document_received_date,document_received_amount\n3043836,2026-09-24,12500.50\n\n(ต้องมียอดรับเอกสารทุกแถว — ถ้า encounter แยกหลายสิทธิ เพิ่มคอลัมน์ payer_id เพื่อระบุแถว — ถ้าไม่ใส่จะลงทุกสิทธิของ encounter นั้น)',
  },
  audit: {
    label: 'Audit',
    dateCol: 'audit_date',
    example:
      'encounter_id,audit_date\n3043836,2026-09-25\n\n(ถ้า encounter แยกหลายสิทธิ เพิ่มคอลัมน์ payer_id เพื่อระบุแถว — ถ้าไม่ใส่จะลงทุกสิทธิของ encounter นั้น)',
  },
  submission: {
    label: 'ส่งเบิก',
    dateCol: 'submission_date',
    amountCol: 'submission_amount',
    needsPayerCheck: true,
    example:
      'อัพโหลดไฟล์ .xls "ตั้งเบิก ประเภทออกใบแจ้งหนี้ สิทธิ GGO" ได้เลย (ไม่ต้องแก้ไฟล์)\n\nระบบแมพให้อัตโนมัติ:\nenc_id → encounter_id · payer → payer_id · claim_no → claim_no\ndateclaim → วันที่ส่งเบิก (แปลง พ.ศ. → ค.ศ.) · claim_amount → ยอดส่งเบิก\nแถวที่ claimcancel มี "X" = ยกเลิก ไม่นับเป็นการส่งเบิก',
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
  /** ข้ามโดยตั้งใจ (ไม่ใช่ error) เช่น claimcancel = X */
  skip?: string
}

export default function BulkClaimUpload({ admissions, onClose, onDone, allowedStages }: Props) {
  const stageList = (Object.keys(STAGE_CONFIG) as BulkStage[]).filter((s) => !allowedStages || allowedStages.includes(s))
  const [stage, setStage] = useState<BulkStage>(stageList.includes('audit') ? 'audit' : stageList[0])
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

  // หา admission ของ encounter + payer ที่ตรงกัน (ใช้กับไฟล์ GGO ที่มี payer ทุกแถว)
  function resolveByPayer(encId: number, payerId: string): { targets: Target[]; error?: string } {
    const candidates = byEncounter.get(encId) ?? []
    if (candidates.length === 0) return { targets: [], error: 'ไม่พบ encounter_id นี้ในระบบ' }
    const targets = candidates
      .filter((a) => (a.payer_id ?? '').trim().toLowerCase() === payerId.toLowerCase())
      .map((a) => ({ admission_id: a.admission_id, encounter_id: a.encounter_id }))
    if (targets.length === 0) {
      const sys = candidates.map((a) => a.payer_id || '—').join(', ')
      return { targets: [], error: `payer ไม่ตรงกับระบบ (ระบบ: ${sys}, ไฟล์: ${payerId})` }
    }
    return { targets }
  }

  // ขั้นส่งเบิก: อ่านไฟล์ .xls ของระบบเบิก แล้วแปลงให้เข้ากับ DB ของเรา
  async function handleGgoFile(file: File) {
    try {
      const ggoRows = await parseGgoClaimFile(file)
      const parsed: ParsedRow[] = ggoRows.map((g) => {
        const base = {
          encounter_id: g.encounterId,
          date: g.claimDate ?? g.claimDateRaw,
          amount: g.claimAmount ?? undefined,
          payerId: g.payerId,
          claimNo: g.claimNo,
          raw: { name: g.name },
        }
        // claimcancel มี X → ไม่นับ ไม่เอามาเบิก (ข้ามก่อนเช็คอย่างอื่น)
        if (g.cancelled) return { ...base, targets: [], skip: 'ยกเลิก (claimcancel = X)' }
        if (!g.encounterId) return { ...base, targets: [], error: 'enc_id ไม่ถูกต้อง' }
        if (!g.payerId) return { ...base, targets: [], error: 'ไม่มี payer' }
        if (!g.claimNo) return { ...base, targets: [], error: 'ไม่มี claim_no' }
        if (!g.claimDate) return { ...base, targets: [], error: `อ่านวันที่ไม่ได้ (${g.claimDateRaw || 'ว่าง'})` }
        if (g.claimAmount === null) return { ...base, targets: [], error: 'claim_amount ไม่ถูกต้อง' }
        const { targets, error } = resolveByPayer(g.encounterId, g.payerId)
        return { ...base, targets, error }
      })
      setRows(parsed)
    } catch (e) {
      setRows([])
      setResult(`อ่านไฟล์ไม่ได้: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  function handleFile(file: File) {
    setFileName(file.name)
    setResult(null)
    if (stage === 'submission') {
      void handleGgoFile(file)
      return
    }
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const parsed: ParsedRow[] = res.data.map((r) => {
          const encId = Number(r['encounter_id']?.trim())
          const date = r[cfg.dateCol]?.trim() ?? ''
          const amountRaw = cfg.amountCol ? r[cfg.amountCol]?.trim() : undefined
          const amount = amountRaw ? Number(amountRaw.replace(/,/g, '')) : undefined
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
          } else if (cfg.amountCol && cfg.amountRequired && !amountRaw) {
            error = `ต้องระบุ ${cfg.amountCol}`
          } else if (amount !== undefined && !Number.isFinite(amount)) {
            error = `${cfg.amountCol} ไม่ใช่ตัวเลข`
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
            amount,
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
    const valid = rows.filter((r) => !r.error && !r.skip)
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

    // กัน admission_id ซ้ำในชุดเดียว (Postgres ไม่ให้ upsert แถวเดิมสองครั้งในคำสั่งเดียว) — ใช้แถวหลังสุด
    const unique = [...new Map(payload.map((p) => [p.admission_id, p])).values()]

    const { error, count } = await supabase
      .from('case_tracking')
      .upsert(unique, { onConflict: 'admission_id', count: 'exact' })

    setUploading(false)
    if (error) {
      setResult(`เกิดข้อผิดพลาด: ${error.message}`)
    } else {
      setResult(`บันทึกสำเร็จ ${count ?? unique.length} รายการ (แถวสิทธิ)`)
      onDone()
    }
  }

  const skipCount = rows.filter((r) => r.skip).length
  const errorCount = rows.filter((r) => r.error).length
  const validCount = rows.length - skipCount - errorCount

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4">
      <div className="w-full max-w-2xl rounded-2xl bg-surface p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">อัพโหลดสถานะเคลมแบบ Bulk</h2>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-lg leading-none text-ink hover:bg-brand">
            ✕
          </button>
        </div>

        <label className="mb-1 block text-sm font-medium text-ink/80">ขั้นตอนที่จะอัพเดต</label>
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
          {stageList.map((s) => (
            <option key={s} value={s}>
              {STAGE_CONFIG[s].label}
            </option>
          ))}
        </select>

        <p className="mb-2 whitespace-pre-wrap rounded-lg bg-paper px-3 py-2 font-mono text-sm text-ink/70">{cfg.example}</p>
        {cfg.needsPayerCheck && (
          <p className="mb-2 text-sm text-ink/70">
            ระบบจะเช็ค payer ในไฟล์กับ payer ที่บันทึกไว้ของ encounter นั้น (และ encounter ที่แยกหลายสิทธิจะลงเฉพาะแถวสิทธิที่ payer ตรงกัน) ถ้าไม่ตรงจะไม่บันทึกแถวนั้น กันแมพผิดเคส
          </p>
        )}

        <input
          type="file"
          accept={stage === 'submission' ? '.xls,.xlsx' : '.csv'}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          className="input mb-3"
        />

        {fileName && rows.length > 0 && (
          <div className="mb-3 max-h-64 overflow-y-auto rounded-lg border border-line text-xs">
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
                  <tr key={i} className={`border-t border-line ${r.skip ? 'opacity-60' : ''}`}>
                    <td className="px-2 py-1.5">{r.encounter_id || '—'}</td>
                    <td className="px-2 py-1.5">{r.date || '—'}</td>
                    {cfg.amountCol && <td className="px-2 py-1.5">{r.amount ?? '—'}</td>}
                    {cfg.needsPayerCheck && <td className="px-2 py-1.5">{r.claimNo || '—'}</td>}
                    <td className="px-2 py-1.5">{r.error || r.skip ? '—' : r.targets.length}</td>
                    <td className="px-2 py-1.5">
                      {r.skip ? (
                        <span className="text-ink/50">{r.skip}</span>
                      ) : r.error ? (
                        <span className="text-rose">{r.error}</span>
                      ) : (
                        <span className="text-ink font-semibold">พร้อมบันทึก</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rows.length > 0 && (
          <p className="mb-3 text-sm text-ink/70">
            พร้อมบันทึก {validCount} แถว
            {skipCount > 0 && <span> · ข้าม (ยกเลิก X) {skipCount} แถว</span>}
            {errorCount > 0 && <span className="text-rose"> · ผิดพลาด {errorCount} แถว</span>}
          </p>
        )}

        {result && <p className="mb-3 text-sm text-ink">{result}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-ink/40 px-4 py-2 text-sm font-medium text-ink hover:bg-brand-soft">
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
