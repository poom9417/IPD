import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import type { PageKey } from './NavMenu'
import NoticeCard, { btnGhost, btnPrimary } from './NoticeCard'

interface Notice {
  id: number
  case_id: number
  code_type: 'disease' | 'device' | null
  code: string | null
  round_no: number
  fix_at: string | null
  user_ack_at: string | null
  code_c_cases: { encounter_id: number } | null
}

const TYPE_LABEL = { disease: 'โรค', device: 'อุปกรณ์' } as const
const POLL_MS = 60_000

function fmtStamp(d: string | null) {
  if (!d) return ''
  return new Date(d).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * แจ้งเตือนมุมขวาบน: เมื่อ Audit ตอบรหัส Code C ที่ฉันเป็นคนแจ้ง → ขึ้น popup แยกเป็นแถวต่อ 1 รหัส
 * ปิดด้วย ✕ ได้ (บันทึกว่ารับทราบ) — ถ้า user กด "ไม่ผ่าน" แล้ว Audit ตอบรอบใหม่ จะแจ้งเตือนอีกครั้ง
 */
export default function CodeCNotifier({ onNavigate }: { onNavigate: (p: PageKey) => void }) {
  const { role, session } = useAuth()
  const myId = session?.user.id ?? ''
  const active = (role === 'user' || role === 'admin') && !!myId
  const [notices, setNotices] = useState<Notice[]>([])
  // ปิดในเครื่องทันที แม้บันทึกรับทราบลงฐานข้อมูลไม่สำเร็จ
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    if (!active) return
    const { data, error } = await supabase
      .from('code_c_items')
      .select('id, case_id, code_type, code, round_no, fix_at, user_ack_at, code_c_cases(encounter_id)')
      .eq('added_by', myId)
      .eq('status', 'answered')
      .order('fix_at', { ascending: false })
      .limit(50)
    if (error) return // เงียบไว้ — แจ้งเตือนเป็นแค่ส่วนเสริม ไม่ควรรบกวนหน้าหลัก
    const list = ((data as unknown as Notice[]) ?? []).filter(
      (n) => !n.user_ack_at || (n.fix_at && new Date(n.user_ack_at) < new Date(n.fix_at)),
    )
    setNotices(list)
  }, [active, myId])

  useEffect(() => {
    load()
    if (!active) return
    const t = setInterval(load, POLL_MS)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', onFocus)
    }
  }, [load, active])

  const keyOf = (n: Notice) => `${n.id}:${n.fix_at}`

  // ซ่อนในเครื่อง (ไม่บันทึกรับทราบ) — ใช้เมื่อการ์ดปิดเองครบเวลา จะกลับมาเตือนอีกตอนโหลดหน้าใหม่
  function hideLocal(n: Notice) {
    setHidden((h) => new Set(h).add(keyOf(n)))
  }

  // บันทึกว่ารับทราบแล้ว (กด "รับทราบ" / "ไปที่ Code C")
  async function ack(n: Notice) {
    await supabase.rpc('code_c_ack_item', { p_item_id: n.id })
  }

  const visible = notices.filter((n) => !hidden.has(keyOf(n)))
  if (!active || visible.length === 0) return null

  return (
    <div className="pointer-events-none fixed right-4 top-20 z-[60] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-3">
      {visible.slice(0, 5).map((n) => (
        <NoticeCard
          key={keyOf(n)}
          label="แจ้งเตือน Code C"
          icon={<ChatCheckIcon />}
          title={`Audit ตอบ Code C แล้ว${n.round_no > 1 ? ` (รอบที่ ${n.round_no})` : ''}`}
          autoCloseMs={20000}
          onClosed={() => hideLocal(n)}
          actions={(close) => (
            <>
              <button
                type="button"
                className={btnGhost}
                onClick={() => {
                  void ack(n)
                  close()
                }}
              >
                รับทราบ
              </button>
              <button
                type="button"
                className={btnPrimary}
                onClick={() => {
                  onNavigate('codec')
                  void ack(n)
                  close()
                }}
              >
                ไปที่ Code C
              </button>
            </>
          )}
        >
          <p>
            encounter_id <span className="font-mono font-semibold text-ink">{n.code_c_cases?.encounter_id ?? '—'}</span>
          </p>
          <p className="font-semibold text-ink">
            {n.code_type ? `[${TYPE_LABEL[n.code_type]}] ` : ''}
            {n.code ?? '—'}
          </p>
          <p className="mt-1 text-xs text-ink/60">ตอบเมื่อ {fmtStamp(n.fix_at)} · ไปกดผ่าน / ไม่ผ่านที่หน้า Code C</p>
        </NoticeCard>
      ))}
      {visible.length > 5 && (
        <p className="pointer-events-auto rounded-lg border border-line bg-surface px-3 py-1.5 text-center text-xs text-ink/70 shadow">
          และอีก {visible.length - 5} รายการ — ปิดรายการด้านบนเพื่อดูต่อ
        </p>
      )}
    </div>
  )
}

function ChatCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden="true">
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4 3.5V16h-.5A1.5 1.5 0 0 1 4 14.5v-9Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="m8.5 10 2.2 2.2L15.5 7.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
