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
  const pushLine =
    status.phase === 'error'
      ? status.message
      : state?.last_push_at
        ? `ส่งล่าสุด ${fmtDateTime(state.last_push_at)}${state.last_push_ok === false ? ' (ล้มเหลว)' : ''}`
        : status.phase === 'ok'
          ? status.message
          : ''
  const pullLine = state?.last_pull_at ? `ดึงล่าสุด ${fmtDateTime(state.last_pull_at)}` : ''

  return (
    <>
      <div className="flex flex-col items-start gap-0.5">
        <div className="flex gap-2">
          <FlyShareButton
            dataTour="sheet-push"
            status={status}
            onPush={() => onPush()}
            title="ส่งเคสใหม่ไปวางต่อท้าย และแก้แถวเดิมที่ข้อมูลเปลี่ยน ในแท็บ ทะเบียนคุมเอกสารสิทธิ 70 (ไม่เรียง/ไม่ย้ายแถวเดิม)"
          />
          <Button
            variant="outline"
            data-tour="sheet-pull"
            onClick={() => setShowPull(true)}
            title="อ่านวัน Audit จากชีตของทีม Audit แล้วตรวจก่อนบันทึก"
            className="whitespace-nowrap"
          >
            ⬇ ดึง Audit จาก Sheet
          </Button>
        </div>
        <button
          onClick={() => {
            if (window.confirm('สร้างชีตใหม่ทั้งหมด?\n\nระบบจะล้างข้อมูลในแท็บ ทะเบียนคุมเอกสารสิทธิ 70 แล้วเขียนใหม่ทั้งหมดจากระบบ (สีแดงที่ทำไว้จะหาย) ใช้เมื่อชีตผิดเพี้ยนเท่านั้น')) onPush('rebuild')
          }}
          disabled={running}
          className="text-xs text-ink/40 underline hover:text-ink disabled:opacity-40"
        >
          ซ่อม: สร้างชีตใหม่ทั้งหมด
        </button>
        {(pushLine || pullLine) && (
          <span className={`text-xs ${status.phase === 'error' ? 'text-rose' : 'text-ink/50'}`}>
            {[pushLine, status.phase === 'error' ? '' : pullLine].filter(Boolean).join(' · ')}
          </span>
        )}
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
