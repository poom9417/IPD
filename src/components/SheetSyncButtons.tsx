import { useEffect, useState } from 'react'
import { fetchSyncState, fmtDateTime, type PushMode, type PushStatus, type SyncState } from '../lib/sheetSync'
import SheetAuditPull from './SheetAuditPull'
import FlyShareButton from './FlyShareButton'
import Button from './ui/Button'

interface Props {
  status: PushStatus
  /** mode = 'rebuild' → ล้างแล้วเขียนชีตใหม่ทั้งหมด (ใช้ซ่อม) */
  onPush: (mode?: PushMode) => void
  /** เรียกหลังดึงวัน Audit เข้าระบบสำเร็จ (ให้หน้าหลักโหลดข้อมูลใหม่) */
  onPulled: () => void
}

/** ปุ่ม "ส่งไป Google Sheet" และ "ดึง Audit จาก Sheet" (เฉพาะ admin / developer) */
export default function SheetSyncButtons({ status, onPush, onPulled }: Props) {
  const [state, setState] = useState<SyncState | null>(null)
  const [showPull, setShowPull] = useState(false)

  // โหลดเวลาซิงก์ล่าสุดตอนเปิดหน้า และทุกครั้งที่การส่งรอบหนึ่งจบ
  useEffect(() => {
    if (status.phase === 'running') return
    let cancelled = false
    fetchSyncState().then((s) => {
      if (!cancelled) setState(s)
    })
    return () => {
      cancelled = true
    }
  }, [status.phase, status.at])

  const running = status.phase === 'running'
  // popup เหนือปุ่มส่ง: "ส่งล่าสุด ..." (ถ้ายังไม่เคยส่ง แสดงผลการส่งรอบนี้/คำอธิบายปุ่มแทน)
  const lastPushLine = state?.last_push_at
    ? `ส่งล่าสุด ${fmtDateTime(state.last_push_at)}${state.last_push_ok === false ? ' (ล้มเหลว)' : ''}`
    : ''
  const tooltip =
    lastPushLine ||
    (status.phase === 'ok' ? status.message : '') ||
    'ส่งเคสใหม่ไปวางต่อท้าย และแก้แถวเดิมที่ข้อมูลเปลี่ยน ในแท็บ ทะเบียนคุมเอกสารสิทธิ 70 (ไม่เรียง/ไม่ย้ายแถวเดิม)'
  const pullLine = state?.last_pull_at ? `ดึงล่าสุด ${fmtDateTime(state.last_pull_at)}` : ''

  return (
    <>
      <div className="flex flex-col items-start gap-0.5">
        <div className="flex gap-2">
          {/* ปุ่มส่ง: ลิงก์ "ซ่อม" อยู่เหนือปุ่ม (ไม่ดันความสูงแถว) — ตอนชี้เมาส์ที่ปุ่ม popup "ส่งล่าสุด" จะทับลิงก์นี้ */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                if (window.confirm('สร้างชีตใหม่ทั้งหมด?\n\nระบบจะล้างข้อมูลในแท็บ ทะเบียนคุมเอกสารสิทธิ 70 แล้วเขียนใหม่ทั้งหมดจากระบบ (สีแดงที่ทำไว้จะหาย) ใช้เมื่อชีตผิดเพี้ยนเท่านั้น')) onPush('rebuild')
              }}
              disabled={running}
              className="absolute bottom-full left-0 mb-0.5 whitespace-nowrap text-xs leading-4 text-ink/40 underline hover:text-ink disabled:opacity-40"
            >
              ซ่อม: สร้างชีตใหม่ทั้งหมด
            </button>
            <FlyShareButton dataTour="sheet-push" status={status} onPush={() => onPush()} tooltip={tooltip} />
          </div>

          {/* ปุ่มดึง: "ดึงล่าสุด ..." เป็น popup เหนือปุ่มตอนชี้เมาส์ */}
          <span className="group relative inline-flex">
            <Button
              variant="outline"
              data-tour="sheet-pull"
              onClick={() => setShowPull(true)}
              className="whitespace-nowrap"
            >
              ⬇ ดึง Audit จาก Sheet
            </Button>
            {pullLine && (
              <span
                role="tooltip"
                className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2.5 -translate-x-1/2 translate-y-1.5 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs text-white opacity-0 shadow-lg transition after:absolute after:left-1/2 after:top-full after:size-2 after:-translate-x-1/2 after:-translate-y-1/2 after:rotate-45 after:bg-ink after:content-[''] group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100"
              >
                {pullLine}
              </span>
            )}
          </span>
        </div>
        {status.phase === 'error' && <span className="text-xs text-rose">{status.message}</span>}
      </div>

      {showPull && (
        <SheetAuditPull
          onClose={() => setShowPull(false)}
          onDone={() => {
            onPulled()
            fetchSyncState().then(setState)
          }}
        />
      )}
    </>
  )
}
