import { useEffect, useState } from 'react'
import Navbar from './Navbar'
import { type PageKey } from './NavMenu'
import Dashboard from '../pages/Dashboard'
import CodeCPage from '../pages/CodeCPage'
import MyJobPage from '../pages/MyJobPage'
import MyJobDashboardPage from '../pages/MyJobDashboardPage'
import { useAuth } from '../contexts/AuthContext'

const VALID: PageKey[] = ['mine', 'codec', 'myjob-dashboard', 'myjob-claim']

function readHash(): PageKey {
  const raw = window.location.hash.replace('#', '')
  // ลิงก์เก่า #myjob (หน้าเลือกสิทธิเดิม) → ย้ายไปที่ My claim
  const h = (raw === 'myjob' ? 'myjob-claim' : raw) as PageKey
  return VALID.includes(h) ? h : 'mine'
}

export default function AppLayout() {
  const { role, roleLoading } = useAuth()
  const [page, setPage] = useState<PageKey>(readHash)

  // My job: เฉพาะ admin และ user (audit / viewer เข้าไม่ได้ แม้พิมพ์ #myjob-dashboard / #myjob-claim ใน URL เอง)
  const canJob = role === 'admin' || role === 'user'

  // เก็บหน้าปัจจุบันไว้ใน URL hash — refresh แล้วยังอยู่หน้าเดิม
  useEffect(() => {
    const onHash = () => setPage(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // รอโหลด role เสร็จก่อนค่อยเด้ง ไม่งั้น admin ที่ refresh หน้า My job จะโดนเด้งออกผิดๆ
  useEffect(() => {
    if (page.startsWith('myjob') && !roleLoading && role !== null && !canJob) go('mine')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, role, roleLoading, canJob])

  function go(p: PageKey) {
    window.location.hash = p
    setPage(p)
  }

  return (
    <div className="min-h-screen">
      <Navbar page={page} onNavigate={go} />
      <div className="min-w-0">
        {page === 'mine' && <Dashboard />}
        {page === 'codec' && <CodeCPage />}
        {page === 'myjob-dashboard' && canJob && <MyJobDashboardPage />}
        {page === 'myjob-claim' && canJob && <MyJobPage />}
      </div>
    </div>
  )
}
