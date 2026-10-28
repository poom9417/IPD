import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import type { AssignmentRequest, CoveragePayerPair } from '../lib/types'
import NoticeCard, { btnDanger, btnGhost, btnPrimary } from './NoticeCard'
import Button from './ui/Button'

interface Props {
  /** เรียกหลังยืนยัน/ปฏิเสธสำเร็จ — ให้หน้าหลักโหลด "สิทธิของฉัน" ใหม่ */
  onChanged?: () => void
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })
}

const nameOf = (email: string | null) => (email ? email.split('@')[0] : '—')

function ShieldCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden="true">
      <path d="M12 3.5 5 6v5.5c0 4.2 2.8 7.3 7 9 4.2-1.7 7-4.8 7-9V6l-7-2.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="m8.8 12 2.4 2.4 4.2-4.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * แจ้งเตือนมุมขวาบน: สิทธิ (สิทธิ+ผู้จ่าย) ที่ Audit / Developer เลือกให้ฉันดูแล แต่ฉันยังไม่ได้ยืนยัน
 * กด "ตรวจสอบ" เปิดหน้าต่างรายการเพื่อยืนยัน/ปฏิเสธรายตัว — ไม่มีรายการรอ = ไม่แสดงอะไรเลย
 */
export default function PendingAssignmentsBanner({ onChanged }: Props) {
  const { session } = useAuth()
  const myId = session?.user.id ?? ''
  const [items, setItems] = useState<AssignmentRequest[]>([])
  const [names, setNames] = useState<Map<string, CoveragePayerPair>>(new Map())
  const [busy, setBusy] = useState(false)
  const [declining, setDeclining] = useState<number | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [open, setOpen] = useState(false)
  // "ไว้ทีหลัง" ซ่อนการ์ดจนกว่าจะโหลดหน้าใหม่ — ไม่ทิ้งงานค้างเพราะกลับเข้าหน้าหลักแล้วขึ้นอีก
  const [snoozed, setSnoozed] = useState(false)

  const load = useCallback(async () => {
    if (!myId) return
    const { data, error } = await supabase
      .from('assignment_requests')
      .select('id, coverage_code, payer_id, user_id, user_email, assigned_by_email, created_at')
      .eq('user_id', myId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
    // ยังไม่ได้รัน SQL (ไม่มีตาราง) หรืออ่านไม่ได้ → ไม่แสดงแบนเนอร์ ไม่รบกวนหน้าหลัก
    if (error) {
      setItems([])
      return
    }
    const rows = (data as AssignmentRequest[]) ?? []
    setItems(rows)
    if (rows.length > 0) {
      const codes = [...new Set(rows.map((r) => r.coverage_code))]
      const { data: pairs } = await supabase
        .from('coverage_payer_pairs')
        .select('*')
        .in('coverage_code', codes)
      const m = new Map<string, CoveragePayerPair>()
      for (const p of (pairs as CoveragePayerPair[]) ?? []) m.set(`${p.coverage_code}|${p.payer_id}`, p)
      setNames(m)
    }
  }, [myId])

  useEffect(() => {
    load()
    // กลับมาเปิดแท็บนี้ → เช็คใหม่ เพื่อให้เห็นการแจ้งเตือนโดยไม่ต้อง refresh
    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  async function respond(ids: number[], accept: boolean) {
    setBusy(true)
    setMessage(null)
    const { data, error } = await supabase.rpc('respond_assignments', { p_ids: ids, p_accept: accept })
    setBusy(false)
    setDeclining(null)
    if (error) {
      setMessage({ ok: false, text: `ทำรายการไม่สำเร็จ: ${error.message}` })
      return
    }
    const failed = ((data as { failed?: { coverage_code: string; payer_id: string }[] } | null)?.failed ?? []).map(
      (f) => `${f.coverage_code} (${f.payer_id})`,
    )
    if (failed.length > 0) {
      setMessage({ ok: false, text: `${failed.join(', ')} มีผู้ดูแลอื่นไปแล้ว จึงรับไม่ได้` })
    } else {
      setMessage({ ok: true, text: accept ? 'ยืนยันรับสิทธิแล้ว' : 'ปฏิเสธแล้ว — สิทธินี้กลับไปเป็นว่าง' })
    }
    await load()
    onChanged?.()
  }

  const first = items[0]
  const firstInfo = first ? names.get(`${first.coverage_code}|${first.payer_id}`) : undefined
  const desc = first
    ? `${first.coverage_code} · ผู้จ่าย ${first.payer_id}${items.length > 1 ? ` และอีก ${items.length - 1} รายการ` : ''}`
    : ''

  return (
    <>
      {items.length > 0 && !snoozed && !open && (
        <div className="pointer-events-none fixed left-4 right-4 top-[max(1rem,env(safe-area-inset-top))] z-[60] sm:left-auto sm:w-[360px]">
          <NoticeCard
            label="สิทธิรอให้คุณยืนยัน"
            icon={<ShieldCheckIcon />}
            count={items.length}
            title="มีสิทธิรอให้คุณยืนยัน"
            onClosed={() => setSnoozed(true)}
            actions={(close) => (
              <>
                <button type="button" className={btnGhost} onClick={close}>
                  ไว้ทีหลัง
                </button>
                <button
                  type="button"
                  className={btnPrimary}
                  onClick={() => {
                    setMessage(null)
                    setOpen(true)
                  }}
                >
                  ตรวจสอบ
                </button>
              </>
            )}
          >
            <p className="truncate" title={desc}>
              {desc}
            </p>
            {firstInfo?.coverage_name && <p className="truncate text-xs text-ink/60">{firstInfo.coverage_name}</p>}
          </NoticeCard>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/40 px-4">
          {(
            <div className="anim-pop-in flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-line border-t-4 border-t-brand bg-surface p-6 shadow-xl">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-bold text-ink">สิทธิรอให้คุณยืนยัน {items.length.toLocaleString()} รายการ</h2>
                <Button
                  variant="icon"
                  onClick={() => setOpen(false)}
                  aria-label="ปิด"
                >
                  ✕
                </Button>
              </div>
              <p className="mb-3 text-sm text-ink/70">
                Audit / Developer เลือกสิทธิเหล่านี้ให้คุณดูแล — เมื่อยืนยันแล้วจะกลายเป็นงานของคุณและยกเลิกเองไม่ได้
              </p>
              {message && (
                <p className={'mb-3 text-sm ' + (message.ok ? 'font-semibold text-ink' : 'text-rose')}>{message.text}</p>
              )}
              {items.length === 0 ? (
                <p className="py-8 text-center text-sm text-ink/70">ไม่มีรายการรอยืนยันแล้ว</p>
              ) : (
                <ul className="divide-y divide-line overflow-y-auto rounded-lg border border-line">
                  {items.map((r) => {
                    const info = names.get(`${r.coverage_code}|${r.payer_id}`)
                    return (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                        <div className="min-w-0 text-sm">
                          <p className="text-ink">
                            <span className="font-mono text-[13px] font-semibold">{r.coverage_code}</span>{' '}
                            {info?.coverage_name ?? ''}
                          </p>
                          <p className="text-ink/70">
                            ผู้จ่าย <span className="font-mono text-[13px]">{r.payer_id}</span> {info?.payer_name ?? ''} ·
                            เลือกโดย {nameOf(r.assigned_by_email)} · {fmtDate(r.created_at)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {declining === r.id ? (
                            <>
                              <span className="text-sm text-ink/80">ปฏิเสธรายการนี้?</span>
                              <button type="button" disabled={busy} onClick={() => respond([r.id], false)} className={btnDanger}>
                                ปฏิเสธ
                              </button>
                              <button type="button" onClick={() => setDeclining(null)} className={btnGhost}>
                                ไม่
                              </button>
                            </>
                          ) : (
                            <>
                              <button type="button" disabled={busy} onClick={() => respond([r.id], true)} className={btnPrimary}>
                                ยืนยัน
                              </button>
                              <button type="button" disabled={busy} onClick={() => setDeclining(r.id)} className={btnGhost}>
                                ปฏิเสธ
                              </button>
                            </>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className={btnGhost}>
                  ปิด
                </button>
                {items.length > 1 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => respond(items.map((i) => i.id), true)}
                    className={btnPrimary}
                  >
                    {busy ? 'กำลังบันทึก…' : 'ยืนยันทั้งหมด'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
