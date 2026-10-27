import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { pairKey } from '../lib/pairKey'
import type { CoveragePayerPair } from '../lib/types'
import type { PageKey } from './NavMenu'
import NoticeCard, { btnGhost, btnPrimary } from './NoticeCard'

interface Props {
  page: PageKey
  onNavigate: (p: PageKey) => void
}

const AUTO_CLOSE_MS = 15000

function ListPlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden="true">
      <path d="M5 6.5h9M5 12h6M5 17.5h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M17.5 12.5v6M14.5 15.5h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

/**
 * แจ้งเตือนมุมขวาบนทุกครั้งที่เข้าระบบใหม่ (admin / user): ยังมีสิทธิ (สิทธิ+ผู้จ่าย) ที่ว่างและไม่มีผู้รับผิดชอบ
 * "ว่าง" = นิยามเดียวกับหน้า My claim → ไม่มีผู้ดูแล และไม่มีคำขอรอยืนยัน
 * แสดงทุกครั้งที่โหลดหน้าเว็บ (login / เปิดเว็บใหม่ / refresh) — ระหว่างสลับหน้าในเว็บไม่เด้งซ้ำ
 * จำแค่ในหน่วยความจำของหน้านี้ (ไม่ใช้ storage) จึงรีเซ็ตเองทุกครั้งที่โหลดหน้าใหม่
 */
let seenThisLoad = false

export default function UnassignedPairsNotifier({ page, onNavigate }: Props) {
  const { role, roleLoading, session } = useAuth()
  const myId = session?.user.id ?? ''
  const active = (role === 'admin' || role === 'user') && !!myId && !roleLoading

  const [free, setFree] = useState<CoveragePayerPair[]>([])
  const [dismissed, setDismissed] = useState(false)

  function markSeen() {
    setDismissed(true)
    seenThisLoad = true
  }

  useEffect(() => {
    if (!active) return
    if (seenThisLoad) {
      setDismissed(true)
      return
    }
    let cancelled = false
    ;(async () => {
      const [cov, asg, req] = await Promise.all([
        supabase.from('coverage_payer_pairs').select('*').order('coverage_code').order('payer_id'),
        supabase.from('coverage_assignments').select('coverage_code, payer_id'),
        supabase.from('assignment_requests').select('coverage_code, payer_id').eq('status', 'pending'),
      ])
      // เงียบไว้ถ้าโหลดไม่ได้ — แจ้งเตือนเป็นแค่ส่วนเสริม ไม่ควรรบกวนหน้าหลัก
      if (cancelled || cov.error || asg.error) return
      const taken = new Set<string>()
      for (const a of (asg.data as { coverage_code: string; payer_id: string }[]) ?? [])
        taken.add(pairKey(a.coverage_code, a.payer_id))
      if (!req.error)
        for (const r of (req.data as { coverage_code: string; payer_id: string }[]) ?? [])
          taken.add(pairKey(r.coverage_code, r.payer_id))
      setFree(((cov.data as CoveragePayerPair[]) ?? []).filter((c) => !taken.has(pairKey(c.coverage_code, c.payer_id))))
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, myId])

  // เปิดหน้า My claim เองแล้ว = เห็นรายการอยู่แล้ว ไม่ต้องเตือนซ้ำ
  useEffect(() => {
    if (page === 'myjob-claim' && free.length > 0 && !dismissed) markSeen()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, free.length, dismissed])

  if (!active || dismissed || free.length === 0 || page === 'myjob-claim') return null

  const codes = [...new Set(free.map((c) => c.coverage_code))]
  const desc = `${codes.slice(0, 3).join(', ')}${codes.length > 3 ? ` และอีก ${codes.length - 3} สิทธิ` : ''}`

  return (
    <div className="pointer-events-none fixed right-4 top-20 z-[60] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-3">
      <NoticeCard
        label="สิทธิที่ยังไม่มีผู้รับผิดชอบ"
        icon={<ListPlusIcon />}
        count={free.length}
        title="ยังมีสิทธิที่ยังไม่ได้เลือก"
        autoCloseMs={AUTO_CLOSE_MS}
        onClosed={markSeen}
        actions={(close) => (
          <>
            <button type="button" className={btnGhost} onClick={close}>
              ไว้ทีหลัง
            </button>
            <button
              type="button"
              className={btnPrimary}
              onClick={() => {
                onNavigate('myjob-claim')
                close()
              }}
            >
              ไปเลือกสิทธิ
            </button>
          </>
        )}
      >
        <p className="truncate" title={desc}>
          {desc}
        </p>
        <p className="mt-1 text-xs text-ink/60">{free.length.toLocaleString()} รายการ (สิทธิ+ผู้จ่าย) ว่างอยู่ ไปเลือกที่ My claim</p>
      </NoticeCard>
    </div>
  )
}
