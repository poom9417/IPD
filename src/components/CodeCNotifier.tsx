import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import type { PageKey } from './NavMenu'

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

  async function dismiss(n: Notice) {
    setHidden((h) => new Set(h).add(keyOf(n)))
    await supabase.rpc('code_c_ack_item', { p_item_id: n.id })
  }

  const visible = notices.filter((n) => !hidden.has(keyOf(n)))
  if (!active || visible.length === 0) return null

  return (
    <div className="pointer-events-none fixed right-4 top-20 z-40 flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {visible.slice(0, 5).map((n) => (
        <div
          key={keyOf(n)}
          role="status"
          className="pointer-events-auto rounded-xl border border-ink/20 border-l-8 border-l-brand bg-surface p-3 shadow-lg"
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 text-sm text-ink">
              <p className="font-semibold">Audit ตอบ Code C แล้ว{n.round_no > 1 ? ` (รอบที่ ${n.round_no})` : ''}</p>
              <p className="mt-0.5">
                encounter_id <span className="font-mono font-semibold">{n.code_c_cases?.encounter_id ?? '—'}</span>
              </p>
              <p className="font-semibold">
                {n.code_type ? `[${TYPE_LABEL[n.code_type]}] ` : ''}
                {n.code ?? '—'}
              </p>
              <p className="mt-1 text-xs text-ink/60">ตอบเมื่อ {fmtStamp(n.fix_at)} · ไปกดผ่าน / ไม่ผ่านที่หน้า Code C</p>
              <button
                onClick={() => {
                  onNavigate('codec')
                  void dismiss(n)
                }}
                className="mt-2 rounded-md bg-brand px-3 py-1 text-xs font-semibold text-ink hover:bg-brand-dark"
              >
                ไปที่ Code C
              </button>
            </div>
            <button
              onClick={() => void dismiss(n)}
              aria-label="ปิดการแจ้งเตือน"
              className="shrink-0 rounded-md px-2 py-0.5 text-lg leading-none text-ink hover:bg-brand"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
      {visible.length > 5 && (
        <p className="pointer-events-auto rounded-lg bg-surface px-3 py-1.5 text-center text-xs text-ink/70 shadow">
          และอีก {visible.length - 5} รายการ — ปิดรายการด้านบนเพื่อดูต่อ
        </p>
      )}
    </div>
  )
}
