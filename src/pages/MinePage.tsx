import { useEffect, useState } from 'react'
import Dashboard from './Dashboard'
import ArSummaryDashboard from '../components/ArSummaryDashboard'
import type { MineMode } from '../components/NavMenu'

interface Props {
  /** โหมดที่เลือก — ปุ่มสลับอยู่บน Navbar (ต่อจากปุ่ม Menu) */
  mode: MineMode
}

/**
 * หน้าหลัก: โหมด Main (ตารางเคส + ตัวกรองเดิม) / Dashboard (สรุปค้างส่งเบิกรวมทุกสิทธิ)
 * ทั้งสองโหมดค้างอยู่ใน DOM (ซ่อนด้วย hidden) — สลับกลับมาแล้วตัวกรอง/หน้าตารางใน Main ไม่หาย
 * และ Dashboard จะโหลดข้อมูลเมื่อเปิดครั้งแรกเท่านั้น
 */
export default function MinePage({ mode }: Props) {
  const [dashOpened, setDashOpened] = useState(mode === 'dashboard')

  useEffect(() => {
    if (mode === 'dashboard') setDashOpened(true)
  }, [mode])

  return (
    <div>
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
