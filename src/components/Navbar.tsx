import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import BrandLogo from './BrandLogo'
import UserManagement from './UserManagement'
import NavMenu, { type PageKey } from './NavMenu'
import type { UiRole } from '../lib/types'

const SIM_OPTIONS: { value: UiRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'user', label: 'ผู้ใช้ทั่วไป (user)' },
  { value: 'audit', label: 'Audit' },
  { value: 'viewer', label: 'ดูอย่างเดียว (viewer)' },
]

const SIM_LABEL: Record<UiRole, string> = {
  admin: 'Admin',
  user: 'ผู้ใช้ทั่วไป (user)',
  audit: 'Audit',
  viewer: 'ดูอย่างเดียว (viewer)',
}

interface Props {
  page: PageKey
  onNavigate: (p: PageKey) => void
}

export default function Navbar({ page, onNavigate }: Props) {
  const { session, role, isDeveloper, canAssign, viewAs, setViewAs, signOut } = useAuth()
  const email = session?.user.email ?? ''
  const [showUsers, setShowUsers] = useState(false)
  // My job: เฉพาะ admin และ user
  const canJob = role === 'admin' || role === 'user'

  return (
    <header className="border-b-4 border-brand bg-ink text-white">
      <div className="flex w-full items-center justify-between gap-3 px-4 py-3 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex items-center gap-2.5">
            <BrandLogo className="h-10 w-10" />
            <p className="hidden text-base font-semibold leading-none text-white md:block">IPD AR Discharge</p>
          </div>
          <NavMenu page={page} canJob={canJob} canAssign={canAssign} onNavigate={onNavigate} />
        </div>

        <div className="flex items-center gap-3">
          <div data-tour="user-info" className="hidden sm:flex flex-col items-end leading-tight">
            <span className="text-sm text-white">{email}</span>
            <span
              className={
                'text-[13px] font-medium ' +
                (role === 'admin' ? 'text-brand' : role === 'user' || role === 'audit' ? 'text-brand/80' : 'text-white/70')
              }
            >
              {isDeveloper
                ? viewAs
                  ? `Developer · กำลังจำลองเป็น ${SIM_LABEL[viewAs]}`
                  : 'Developer (สิทธิ์ Admin + จำลอง role ได้)'
                : role === 'admin'
                ? 'ผู้ดูแลระบบ (แก้ไขได้)'
                : role === 'user'
                  ? 'ผู้ใช้ทั่วไป (เพิ่มเคส/อัพโหลดสถานะเคลมได้)'
                  : role === 'audit'
                    ? 'Audit (บันทึกวัน Audit / แก้เคสติด Code C)'
                    : 'ผู้ใช้งาน (ดูอย่างเดียว)'}
            </span>
          </div>
          {isDeveloper && (
            <label className="flex items-center gap-1.5 text-sm text-white">
              <span className="hidden lg:inline text-white/70">จำลองเป็น</span>
              <select
                data-tour="simulate-role"
                value={viewAs ?? ''}
                onChange={(e) => setViewAs((e.target.value || null) as UiRole | null)}
                className="rounded-lg border border-brand bg-ink px-2 py-1.5 text-sm font-medium text-brand focus:outline-none"
              >
                <option value="">Developer (ปกติ)</option>
                {SIM_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {role === 'admin' && (
            <button
              data-tour="manage-users"
              onClick={() => setShowUsers(true)}
              className="rounded-lg border border-white/30 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand hover:text-ink hover:border-brand transition-colors"
            >
              จัดการผู้ใช้
            </button>
          )}
          <button
            onClick={() => window.dispatchEvent(new Event('ipd-tour-start'))}
            data-tour="tour-again"
            className="rounded-lg border border-white/30 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand hover:text-ink hover:border-brand transition-colors"
          >
            คู่มือใช้งาน
          </button>
          <button
            data-tour="signout"
            onClick={signOut}
            className="rounded-lg border border-white/30 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand hover:text-ink hover:border-brand transition-colors"
          >
            ออกจากระบบ
          </button>
        </div>
      </div>

      {isDeveloper && viewAs && (
        <div className="flex flex-wrap items-center justify-center gap-3 bg-brand px-4 py-1.5 text-sm font-semibold text-ink">
          <span>
            โหมดจำลอง: กำลังดูเหมือนเป็น {SIM_LABEL[viewAs]} — role จริงของคุณยังเป็น Developer ไม่ถูกเปลี่ยน
          </span>
          <button
            onClick={() => setViewAs(null)}
            className="rounded-md border border-ink/60 px-2.5 py-0.5 text-sm font-semibold hover:bg-ink hover:text-brand transition-colors"
          >
            ออกจากโหมดจำลอง
          </button>
        </div>
      )}

      {showUsers && <UserManagement onClose={() => setShowUsers(false)} />}
    </header>
  )
}
