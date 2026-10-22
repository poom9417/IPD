import { useEffect, useState } from 'react'
import Dashboard from './Dashboard'
import ArSummaryDashboard from '../components/ArSummaryDashboard'
import type { MineMode } from '../components/NavMenu'
import { useAuth } from '../contexts/AuthContext'

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
  const { role } = useAuth()
  // audit ไม่เห็นข้อมูลการเงิน → ไม่ render Dashboard เลย (ไม่โหลดข้อมูลด้วย)
  const canDashboard = role !== 'audit'
  const [dashOpened, setDashOpened] = useState(mode === 'dashboard' && canDashboard)

  useEffect(() => {
    if (mode === 'dashboard' && canDashboard) setDashOpened(true)
  }, [mode, canDashboard])

  return (
    <div>
      <div className={mode === 'main' || !canDashboard ? '' : 'hidden'}>
        <Dashboard />
      </div>
      {dashOpened && canDashboard && (
        <div className={mode === 'dashboard' ? '' : 'hidden'}>
          <ArSummaryDashboard />
        </div>
      )}
    </div>
  )
}
