import { useState } from 'react'
import Dashboard from './Dashboard'
import ArSummaryDashboard from '../components/ArSummaryDashboard'

type Mode = 'main' | 'dashboard'

const MODES: { key: Mode; label: string }[] = [
  { key: 'main', label: 'Main' },
  { key: 'dashboard', label: 'Dashboard' },
]

/**
 * หน้าหลัก: โหมด Main (ตารางเคส + ตัวกรองเดิม) / Dashboard (สรุปค้างส่งเบิกรวมทุกสิทธิ)
 * ทั้งสองโหมดค้างอยู่ใน DOM (ซ่อนด้วย hidden) — สลับกลับมาแล้วตัวกรอง/หน้าตารางใน Main ไม่หาย
 * และ Dashboard จะโหลดข้อมูลเมื่อเปิดครั้งแรกเท่านั้น
 */
export default function MinePage() {
  const [mode, setMode] = useState<Mode>('main')
  const [dashOpened, setDashOpened] = useState(false)

  function pick(m: Mode) {
    setMode(m)
    if (m === 'dashboard') setDashOpened(true)
  }

  return (
    <div>
      <div className="w-full px-4 pt-4 sm:px-8">
        <div className="inline-flex rounded-lg border border-ink/30 p-0.5 text-sm" role="tablist" aria-label="โหมดหน้าหลัก">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              role="tab"
              aria-selected={mode === m.key}
              onClick={() => pick(m.key)}
              className={
                'rounded-md px-5 py-1.5 font-medium transition-colors ' +
                (mode === m.key ? 'bg-brand text-ink' : 'text-ink/70 hover:bg-brand-soft')
              }
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className={mode === 'main' ? '' : 'hidden'}>
        <Dashboard />
      </div>
      {dashOpened && (
        <div className={mode === 'dashboard' ? '' : 'hidden'}>
          <ArSummaryDashboard />
        </div>
      )}
    </div>
  )
}
