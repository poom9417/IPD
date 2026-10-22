import { useAuth } from '../contexts/AuthContext'
import BrandLogo from './BrandLogo'
import './NewUserPopup.css'
import { btnGhost } from './NoticeCard'

/** หน้าจอสำหรับผู้ใช้ที่ยังไม่ได้รับอนุมัติ (pending / rejected) — ทำอะไรไม่ได้นอกจากรอและออกจากระบบ */
export default function PendingApprovalPage() {
  const { session, approval, signOut } = useAuth()
  const rejected = approval === 'rejected'

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-xl bg-ink">
          <BrandLogo className="h-11 w-11" />
        </div>
        <div className="np-card rounded-2xl border border-line border-t-4 border-t-brand bg-surface p-6 shadow-xl">
          <h1 className="text-xl font-bold text-ink">
            {rejected ? 'บัญชีนี้ไม่ได้รับอนุมัติ' : 'รอ admin อนุมัติ'}
          </h1>
          <p className="mt-3 text-base text-ink/80">
            {rejected
              ? 'บัญชีของคุณไม่ได้รับอนุมัติให้เข้าใช้งานระบบ IPD AR Discharge'
              : 'บัญชีของคุณยังไม่ได้รับอนุมัติให้เข้าใช้งานระบบ กรุณารอผู้ดูแลระบบอนุมัติก่อน'}
          </p>
          {session?.user.email && (
            <p className="mt-3 rounded-lg bg-paper px-3 py-2 text-sm text-ink/70">
              บัญชีที่ล็อกอิน: <span className="font-medium text-ink">{session.user.email}</span>
            </p>
          )}
          <div className="mt-4 rounded-lg border border-line bg-brand-soft px-3 py-3 text-sm text-ink">
            <p className="font-semibold">ติดต่อเพิ่มเติม</p>
            <p className="mt-1">โทรภายใน <span className="font-bold">8104</span></p>
            <p>
              อีเมล{' '}
              <a href="mailto:nattapoom.chu@mahidol.ac.th" className="font-medium underline">
                nattapoom.chu@mahidol.ac.th
              </a>
            </p>
          </div>
          {!rejected && (
            <p className="mt-3 text-sm text-ink/60">เมื่อได้รับอนุมัติ หน้านี้จะเข้าสู่ระบบให้อัตโนมัติ</p>
          )}
          <button
            onClick={signOut}
            className={btnGhost + " mt-5 w-full"}
          >
            ออกจากระบบ
          </button>
        </div>
      </div>
    </div>
  )
}
