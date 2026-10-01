import { useEffect, useState } from 'react'
import Navbar from './Navbar'
import Sidebar, { type PageKey } from './Sidebar'
import Dashboard from '../pages/Dashboard'
import CodeCPage from '../pages/CodeCPage'
import MyJobPage from '../pages/MyJobPage'

const VALID: PageKey[] = ['mine', 'codec', 'myjob']

function readHash(): PageKey {
  const h = window.location.hash.replace('#', '') as PageKey
  return VALID.includes(h) ? h : 'mine'
}

export default function AppLayout() {
  const [page, setPage] = useState<PageKey>(readHash)

  // เก็บหน้าปัจจุบันไว้ใน URL hash — refresh แล้วยังอยู่หน้าเดิม
  useEffect(() => {
    const onHash = () => setPage(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  function go(p: PageKey) {
    window.location.hash = p
    setPage(p)
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <div className="flex flex-col md:flex-row">
        <Sidebar page={page} onChange={go} />
        <div className="min-w-0 flex-1">
          {page === 'mine' && <Dashboard />}
          {page === 'codec' && <CodeCPage />}
          {page === 'myjob' && <MyJobPage />}
        </div>
      </div>
    </div>
  )
}
