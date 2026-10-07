import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import BrandLogo from './BrandLogo'
import UserManagement from './UserManagement'
import NavMenu, { type PageKey } from './NavMenu'

interface Props {
  page: PageKey
  onNavigate: (p: PageKey) => void
}

export default function Navbar({ page, onNavigate }: Props) {
  const { session, role, signOut } = useAuth()
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
          <NavMenu page={page} canJob={canJob} onNavigate={onNavigate} />
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
              {role === 'admin'
                ? 'ผู้ดูแลระบบ (แก้ไขได้)'
                : role === 'user'
                  ? 'ผู้ใช้ทั่วไป (เพิ่มเคส/อัพโหลดสถานะเคลมได้)'
                  : role === 'audit'
                    ? 'Audit (บันทึกวัน Audit / แก้เคสติด Code C)'
                    : 'ผู้ใช้งาน (ดูอย่างเดียว)'}
            </span>
          </div>
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

      {showUsers && <UserManagement onClose={() => setShowUsers(false)} />}
    </header>
  )
}
