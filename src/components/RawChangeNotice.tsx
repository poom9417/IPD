import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import NoticeCard, { btnGhost, btnPrimary } from './NoticeCard'

const S_DIFF = 'สิทธิ/ผู้จ่ายต่างจากดิบ'
const S_DELETED = 'อยู่ในดิบ แต่ถูกลบจากระบบ'
const HIDE_KEY = 'rawNoticeHiddenOn'

const bkkToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
function addDays(ymd: string, n: number) {
  const d = new Date(ymd + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * แจ้งเตือน admin/developer เมื่อเข้าเว็บ: เมื่อวานมีเคส "สิทธิ/ผู้จ่ายต่างจากดิบ" / "ถูกลบจากระบบ" กี่ราย
 * (นับจากวันที่แก้ไข/ลบ = เมื่อวานตามเวลาไทย) — ติ๊ก "ไม่แสดงอีกในวันนี้" ได้ · อ่านอย่างเดียว ไม่แก้ข้อมูล
 */
export default function RawChangeNotice({ onOpen }: { onOpen: () => void }) {
  const { role, session } = useAuth()
  const active = role === 'admin' && !!session
  const [counts, setCounts] = useState<{ diff: number; del: number } | null>(null)
  const [dontShow, setDontShow] = useState(false)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (!active) return
    try {
      if (localStorage.getItem(HIDE_KEY) === bkkToday()) return
    } catch {
      /* localStorage ใช้ไม่ได้ → แสดงตามปกติ */
    }
    let alive = true
    const t = bkkToday()
    const from = addDays(t, -1) + 'T00:00:00+07:00'
    const to = t + 'T00:00:00+07:00'
    const cnt = (status: string) =>
      supabase
        .from('v_raw_vs_current')
        .select('encounter_id', { count: 'exact', head: true })
        .eq('status', status)
        .gte('last_updated', from)
        .lt('last_updated', to)
    void Promise.all([cnt(S_DIFF), cnt(S_DELETED)]).then(([a, b]) => {
      if (!alive || a.error || b.error) return
      setCounts({ diff: a.count ?? 0, del: b.count ?? 0 })
    })
    return () => {
      alive = false
    }
  }, [active])

  function finish() {
    if (dontShow) {
      try {
        localStorage.setItem(HIDE_KEY, bkkToday())
      } catch {
        /* ไม่เป็นไร */
      }
    }
    setHidden(true)
  }

  if (!active || hidden || !counts || counts.diff + counts.del === 0) return null
  const y = addDays(bkkToday(), -1)

  return (
    <div className="pointer-events-none fixed right-4 top-20 z-[60] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-3">
      <NoticeCard
        label="แจ้งเตือนข้อมูลต่างจากดิบ"
        icon={<span className="text-xl font-bold">!</span>}
        count={counts.diff + counts.del}
        title="เมื่อวานมีเคสที่ต้องตรวจเพิ่ม"
        onClosed={finish}
        actions={(close) => (
          <>
            <button type="button" className={btnGhost} onClick={close}>
              ปิด
            </button>
            <button
              type="button"
              className={btnPrimary}
              onClick={() => {
                onOpen()
                close()
              }}
            >
              ดูรายการ
            </button>
          </>
        )}
      >
        <p className="text-sm text-ink/80">
          ข้อมูลวันที่ {new Date(y + 'T00:00:00Z').toLocaleDateString('th-TH', { day: 'numeric', month: 'long', timeZone: 'UTC' })}
        </p>
        <ul className="mt-1 space-y-0.5 text-sm text-ink">
          <li>สิทธิ/ผู้จ่ายต่างจากดิบ: <b>{counts.diff}</b> ราย</li>
          <li>ถูกลบจากระบบ: <b>{counts.del}</b> ราย</li>
        </ul>
        <label className="mt-2 flex items-center gap-2 text-xs text-ink/70">
          <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} />
          ไม่แสดงอีกในวันนี้
        </label>
      </NoticeCard>
    </div>
  )
}
