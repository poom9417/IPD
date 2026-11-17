import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { parseHisAmountFile, type HisAmountRow } from '../lib/hisAmountFile'
import Button from './ui/Button'

interface Props {
  onClose: () => void
  /** บันทึกสำเร็จ (อย่างน้อย 1 แถว) → ให้หน้าหลักโหลดข้อมูลใหม่ */
  onDone: () => void
}

type Status =
  | 'ok'
  | 'ok_fallback'
  | 'has_amount'
  | 'not_found'
  | 'mismatch'
  | 'ambiguous'
  | 'dup_in_file'
  | 'invalid'
  | 'negative'

interface ResultRow {
  idx: number
  encounter_id: number | null
  hn: string | null
  coverage_code: string
  payer_id: string
  amount: number | null
  status: Status
  admission_id: number | null
  sys_coverage: string | null
  sys_payer: string | null
  old_amount: number | null
  note: string | null
}

const STATUS_LABEL: Record<Status, string> = {
  ok: 'พร้อมบันทึก',
  ok_fallback: 'พร้อมบันทึก (สิทธิในระบบต่างจากไฟล์)',
  has_amount: 'มียอดเดิม — ข้าม',
  not_found: 'ไม่พบเคสในระบบ',
  mismatch: 'ไม่ตรงกับระบบ',
  ambiguous: 'ระบุแถวไม่ได้',
  dup_in_file: 'ซ้ำในไฟล์ — ข้าม',
  invalid: 'ข้อมูลไม่ถูกต้อง',
  negative: 'ยอดติดลบ — ไม่บันทึก',
}

const WILL_WRITE: Status[] = ['ok', 'ok_fallback']
// กลุ่มที่ต้องแจ้งเตือน (ไม่บันทึก เพราะหาเคสไม่เจอ/ไม่ตรง) — ผู้ใช้ต้องตามเช็คเอง
const WARN: Status[] = ['not_found', 'mismatch', 'ambiguous', 'invalid', 'negative']

const fmt = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * นำเข้า "ยอดเงินจาก HIS" จากไฟล์ .xlsx แทน user ปกติ (admin / developer เท่านั้น — DB เช็คซ้ำ)
 * ไฟล์นี้ใช้ใส่ยอดอย่างเดียว: ไม่สร้างเคสใหม่, ไม่แตะวันที่รับเอกสาร, ไม่เขียนทับยอดที่มีอยู่แล้ว
 */
export default function ImportHisAmounts({ onClose, onDone }: Props) {
  const [fileName, setFileName] = useState('')
  const [fileRows, setFileRows] = useState<HisAmountRow[]>([])
  const [rows, setRows] = useState<ResultRow[]>([])
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [onlyProblems, setOnlyProblems] = useState(false)

  const payload = (src: HisAmountRow[]) =>
    src.map((r) => ({
      encounter_id: r.encounterId,
      hn: r.hn,
      coverage_code: r.coverageCode,
      payer_id: r.payerId,
      amount: r.amount,
    }))

  async function handleFile(file: File) {
    setFileName(file.name)
    setError(null)
    setResult(null)
    setRows([])
    setFileRows([])
    setChecking(true)
    try {
      const parsed = await parseHisAmountFile(file)
      setFileRows(parsed)
      const { data, error: rpcErr } = await supabase.rpc('import_his_amounts', { p_rows: payload(parsed), p_apply: false })
      if (rpcErr) throw rpcErr
      setRows(((data as { rows: ResultRow[] }).rows ?? []) as ResultRow[])
    } catch (e) {
      setError(`ตรวจไฟล์ไม่สำเร็จ: ${e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e)}`)
    } finally {
      setChecking(false)
    }
  }

  const count = (s: Status[]) => rows.filter((r) => s.includes(r.status)).length
  const writeN = count(WILL_WRITE)
  const fallbackN = count(['ok_fallback'])
  const skipN = count(['has_amount', 'dup_in_file'])
  const warnN = count(WARN)

  async function handleConfirm() {
    if (writeN === 0 || saving || checking) return
    setSaving(true)
    setError(null)
    try {
      const { data, error: rpcErr } = await supabase.rpc('import_his_amounts', { p_rows: payload(fileRows), p_apply: true })
      if (rpcErr) throw rpcErr
      const res = data as { rows: ResultRow[]; applied: number }
      setRows(res.rows ?? [])
      setResult(
        `บันทึกยอดเงินจาก HIS สำเร็จ ${res.applied} เคส` +
          (skipN > 0 ? ` · ข้าม ${skipN}` : '') +
          (warnN > 0 ? ` · ต้องตรวจเอง ${warnN} (ดูรายการสีแดงด้านล่าง)` : ''),
      )
      if (res.applied > 0) onDone()
    } catch (e) {
      setError(`บันทึกไม่สำเร็จ: ${e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  // หลังบันทึกแล้ว สถานะ "พร้อมบันทึก" จะกลายเป็น "มียอดเดิม" เมื่อตรวจซ้ำ — ใช้ result ที่ตั้งไว้แทน
  const done = result !== null
  const shown = onlyProblems ? rows.filter((r) => WARN.includes(r.status)) : rows

  return (
    <div className="modal-overlay">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-y-auto rounded-2xl bg-surface p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">นำเข้ายอดเงินจาก HIS (แทน user)</h2>
          <Button variant="icon" onClick={onClose} disabled={saving}>
            ✕
          </Button>
        </div>

        <p className="mb-2 whitespace-pre-wrap rounded-lg bg-paper px-3 py-2 text-sm text-ink/70">
          {`อัพโหลดไฟล์ยอดเงินจาก HIS (.xlsx) — ระบบใช้คอลัมน์ encid, hn, coverageCode, payerCode, discount, claimAmt
จับคู่ Encounter ID + HN + สิทธิ + ผู้จ่าย (payer ว่าง = UNK) แล้วบันทึก claimAmt + discount ลงช่อง "ยอดเงินจาก HIS"
• ไม่เขียนทับเคสที่มียอดอยู่แล้ว • ไม่สร้างเคสใหม่ • ไม่แตะวันที่รับเอกสาร (สถานะยังเป็นรอรับเอกสารตามเดิม)`}
        </p>

        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => e.target.files?.[0] && void handleFile(e.target.files[0])}
          className="form-input mb-3"
          disabled={saving}
        />

        {checking && <p className="mb-3 text-sm text-ink/60">กำลังตรวจไฟล์กับข้อมูลในระบบ…</p>}
        {error && <p className="mb-3 text-sm text-rose">{error}</p>}

        {fileName && rows.length > 0 && (
          <>
            <p className="mb-2 text-sm text-ink/70">
              ทั้งหมด {rows.length} แถว · {done ? 'บันทึกแล้ว' : `พร้อมบันทึก ${writeN}`}
              {!done && fallbackN > 0 && <span> (รวมสิทธิในระบบต่างจากไฟล์ {fallbackN})</span>}
              {skipN > 0 && <span> · ข้าม {skipN}</span>}
              {warnN > 0 && <span className="font-semibold text-rose"> · แจ้งเตือน {warnN}</span>}
            </p>

            {warnN > 0 && (
              <div className="mb-3 rounded-lg border border-rose/40 bg-rose-soft/40 px-3 py-2 text-sm text-rose">
                มี {warnN} แถวที่หาเคสในระบบไม่เจอหรือไม่ตรง — จะไม่ถูกบันทึก ตรวจสอบรายการสีแดงในตารางด้านล่าง
                <label className="ml-3 inline-flex cursor-pointer items-center gap-1.5 text-ink">
                  <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
                  แสดงเฉพาะที่แจ้งเตือน
                </label>
              </div>
            )}

            <div className="mb-3 max-h-80 overflow-y-auto rounded-lg border border-line text-xs">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-paper text-ink/50">
                  <tr>
                    <th className="px-2 py-1.5">encounter_id</th>
                    <th className="px-2 py-1.5">HN</th>
                    <th className="px-2 py-1.5">สิทธิ / payer (ไฟล์)</th>
                    <th className="px-2 py-1.5 text-right">ยอด (claimAmt+discount)</th>
                    <th className="px-2 py-1.5">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const warn = WARN.includes(r.status)
                    return (
                      <tr key={r.idx} className={`border-t border-line ${r.status === 'has_amount' || r.status === 'dup_in_file' ? 'opacity-60' : ''}`}>
                        <td className="px-2 py-1.5 font-mono">{r.encounter_id ?? '—'}</td>
                        <td className="px-2 py-1.5 font-mono">{r.hn ?? '—'}</td>
                        <td className="px-2 py-1.5">
                          {r.coverage_code} / {r.payer_id}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.amount)}</td>
                        <td className="px-2 py-1.5">
                          <span className={warn ? 'font-semibold text-rose' : r.status === 'ok_fallback' ? 'font-semibold text-alert' : 'text-ink'}>
                            {STATUS_LABEL[r.status]}
                          </span>
                          {r.note && <span className="block text-ink/60">{r.note}</span>}
                          {r.status === 'has_amount' && <span className="block text-ink/60">ยอดเดิม {fmt(r.old_amount)}</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {result && <p className="mb-3 text-sm font-semibold text-ink">{result}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            ปิด
          </Button>
          <Button variant="primary" onClick={handleConfirm} disabled={writeN === 0 || saving || checking || done}>
            {saving ? 'กำลังบันทึก…' : `บันทึก ${writeN} เคส`}
          </Button>
        </div>
      </div>
    </div>
  )
}
