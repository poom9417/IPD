import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { refreshReadyToImport, useReadyToImport } from '../lib/readyToImport'
import NoticeCard, { btnGhost, btnPrimary } from './NoticeCard'

interface Props {
  /** กด "ตรวจสอบ" → พาไปหน้าหลัก (Main) แล้วเปิดหน้าดึง Audit จาก Sheet */
  onReview: () => void
}

/** ตรวจซ้ำทุก 30 นาทีระหว่างเปิดเว็บทิ้งไว้ */
const RECHECK_MS = 30 * 60 * 1000

function CalendarCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden="true">
      <rect x="4" y="5.5" width="16" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="m9.5 14.5 1.8 1.8 3.4-3.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * แจ้งเตือน admin / developer: ในชีต Audit มีวัน Audit ที่ "พร้อมนำเข้า" แต่ยังไม่ได้นำเข้าระบบ
 * - ตรวจตอนเข้าเว็บ และซ้ำทุก 30 นาที (อ่านชีตอย่างเดียว ไม่บันทึกอะไร)
 * - การ์ดเด้งตอนมีเคสค้าง ไม่ปิดเอง (กัน "ลืมเข้าไปตรวจ"); กด "ไว้ทีหลัง" แล้วจะไม่เด้งซ้ำจนกว่าจำนวนที่ค้างจะเพิ่มขึ้น
 * - ป้ายตัวเลขบนปุ่ม "ดึง Audit จาก Sheet" ยังอยู่จนกว่าจะนำเข้าครบ
 * ใช้ role ที่แสดงอยู่ (Developer = admin; ถ้ากำลังจำลองเป็น role อื่นจะไม่แสดง)
 */
export default function ReadyToImportNotifier({ onReview }: Props) {
  const { role, roleLoading } = useAuth()
  const active = role === 'admin' && !roleLoading
  const { count } = useReadyToImport()
  // จำนวนที่ผู้ใช้กด "ไว้ทีหลัง" ไว้ล่าสุด — เด้งใหม่เมื่อจำนวนค้างมากกว่านี้
  const [dismissedAt, setDismissedAt] = useState(0)

  useEffect(() => {
    if (!active) return
    void refreshReadyToImport()
    const t = setInterval(() => void refreshReadyToImport(), RECHECK_MS)
    return () => clearInterval(t)
  }, [active])

  // นำเข้าจนเหลือน้อยลง → ปรับเกณฑ์ ไม่ให้เด้งซ้ำตอนจำนวนเพิ่งลด
  useEffect(() => {
    if (count !== null && count < dismissedAt) setDismissedAt(count)
  }, [count, dismissedAt])

  if (!active || count === null || count <= 0 || count <= dismissedAt) return null

  return (
    <div className="pointer-events-none fixed right-4 top-20 z-[60] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-3">
      <NoticeCard
        key={count}
        label="วัน Audit ที่พร้อมนำเข้า"
        icon={<CalendarCheckIcon />}
        count={count}
        title="มีวัน Audit ที่ยังไม่ได้นำเข้า"
        onClosed={() => setDismissedAt(count)}
        actions={(close) => (
          <>
            <button type="button" className={btnGhost} onClick={close}>
              ไว้ทีหลัง
            </button>
            <button
              type="button"
              className={btnPrimary}
              onClick={() => {
                onReview()
                close()
              }}
            >
              ตรวจสอบ
            </button>
          </>
        )}
      >
        <p>ในชีต Audit มี {count.toLocaleString()} เคสที่พร้อมนำเข้า (ยังไม่เคยบันทึกวัน Audit)</p>
        <p className="mt-1 text-xs text-ink/60">กด “ตรวจสอบ” เพื่อเปิดหน้าดึง Audit จาก Sheet</p>
      </NoticeCard>
    </div>
  )
}
