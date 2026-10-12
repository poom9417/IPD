import { useEffect, useState } from 'react'
import { fetchSyncState, fmtDateTime, type PushStatus, type SyncState } from '../lib/sheetSync'
import SheetAuditPull from './SheetAuditPull'

interface Props {
  status: PushStatus
  onPush: () => void
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
          <button
            data-tour="sheet-push"
            onClick={onPush}
            disabled={running}
            title="ส่งเคสทั้งหมดในระบบไปวางทับที่แท็บ ทะเบียนคุมเอกสารสิทธิ 70 (ระบบเป็นต้นฉบับ)"
            className="whitespace-nowrap rounded-lg border border-ink/30 px-4 py-2 text-sm font-medium text-ink transition-colors hover:border-ink hover:bg-brand-soft disabled:opacity-40"
          >
            {running ? 'กำลังส่ง…' : '⬆ ส่งไป Google Sheet'}
          </button>
          <button
            data-tour="sheet-pull"
            onClick={() => setShowPull(true)}
            title="อ่านวัน Audit จากชีตของทีม Audit แล้วตรวจก่อนบันทึก"
            className="whitespace-nowrap rounded-lg border border-ink/30 px-4 py-2 text-sm font-medium text-ink transition-colors hover:border-ink hover:bg-brand-soft"
          >
            ⬇ ดึง Audit จาก Sheet
          </button>
        </div>
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
