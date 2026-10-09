import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import type { AssignmentRequest, CoveragePayerPair } from '../lib/types'

interface Props {
  /** เรียกหลังยืนยัน/ปฏิเสธสำเร็จ — ให้หน้าหลักโหลด "สิทธิของฉัน" ใหม่ */
  onChanged?: () => void
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })
}

const nameOf = (email: string | null) => (email ? email.split('@')[0] : '—')

/**
 * แจ้งเตือนบนหน้าหลัก: สิทธิ (สิทธิ+ผู้จ่าย) ที่ Audit / Developer เลือกให้ฉันดูแล แต่ฉันยังไม่ได้ยืนยัน
 * ไม่มีรายการรอ = ไม่แสดงอะไรเลย
 */
export default function PendingAssignmentsBanner({ onChanged }: Props) {
  const { session } = useAuth()
  const myId = session?.user.id ?? ''
  const [items, setItems] = useState<AssignmentRequest[]>([])
  const [names, setNames] = useState<Map<string, CoveragePayerPair>>(new Map())
  const [busy, setBusy] = useState(false)
  const [declining, setDeclining] = useState<number | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

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

  if (items.length === 0 && !message) return null

  return (
    <section
      role="alert"
      className="rounded-xl border border-line border-l-8 border-l-brand bg-brand-soft/60 px-5 py-4"
    >
      {items.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-bold text-ink">
                มีสิทธิรอให้คุณยืนยัน {items.length.toLocaleString()} รายการ
              </h2>
              <p className="mt-0.5 text-sm text-ink/70">
                Audit / Developer เลือกสิทธิเหล่านี้ให้คุณดูแล — เมื่อยืนยันแล้วจะกลายเป็นงานของคุณและยกเลิกเองไม่ได้
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => respond(items.map((i) => i.id), true)}
              className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-ink ring-1 ring-ink/30 hover:bg-brand-dark disabled:opacity-40"
            >
              {busy ? 'กำลังบันทึก…' : 'ยืนยันทั้งหมด'}
            </button>
          </div>

          <ul className="mt-3 divide-y divide-ink/10 rounded-lg border border-line bg-surface">
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
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => respond([r.id], false)}
                          className="rounded-lg bg-alert px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
                        >
                          ปฏิเสธ
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeclining(null)}
                          className="rounded-lg border border-ink/30 px-3 py-1.5 text-sm font-medium text-ink hover:bg-brand-soft"
                        >
                          ไม่
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => respond([r.id], true)}
                          className="rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-ink ring-1 ring-ink/30 hover:bg-brand-dark disabled:opacity-40"
                        >
                          ยืนยัน
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setDeclining(r.id)}
                          className="rounded-lg border border-ink/30 px-3 py-1.5 text-sm font-medium text-ink hover:bg-brand-soft disabled:opacity-40"
                        >
                          ปฏิเสธ
                        </button>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
      {message && (
        <p className={'mt-2 text-sm ' + (message.ok ? 'font-semibold text-ink' : 'text-rose')}>{message.text}</p>
      )}
    </section>
  )
}
