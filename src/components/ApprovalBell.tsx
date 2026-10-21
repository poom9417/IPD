import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { AppUser } from '../lib/types'
import { useAuth } from '../contexts/AuthContext'

type PickRole = 'viewer' | 'user' | 'audit' | 'admin'

const ROLE_OPTIONS: { value: PickRole; label: string }[] = [
  { value: 'viewer', label: 'ดูอย่างเดียว (viewer)' },
  { value: 'user', label: 'ผู้ใช้ทั่วไป (user)' },
  { value: 'audit', label: 'Audit' },
  { value: 'admin', label: 'Admin' },
]

/** ป้ายแจ้งเตือนอีเมลใหม่ที่รออนุมัติ + หน้าต่างเลือก role แล้วยืนยัน (audit / developer) — กำหนด role ได้เฉพาะ developer; audit อนุมัติได้แต่ไม่กำหนด role */
export default function ApprovalBell() {
  const { isDeveloper } = useAuth()
  const roleOptions = ROLE_OPTIONS
  const [pending, setPending] = useState<AppUser[]>([])
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<Record<string, PickRole>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('app_users')
      .select('id, email, role, unit, created_at, approval_status')
      .eq('approval_status', 'pending')
      .order('created_at')
    if (!error) setPending((data as AppUser[]) ?? [])
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

  async function decide(u: AppUser, status: 'approved' | 'rejected') {
    setBusyId(u.id)
    setError(null)
    const { error } = await supabase.rpc('set_user_approval', {
      p_user: u.id,
      p_status: status,
      p_role: status === 'approved' && isDeveloper ? (picked[u.id] ?? 'viewer') : null,
    })
    if (error) setError(error.message)
    else await load()
    setBusyId(null)
  }

  return (
    <>
      <button
        data-tour="approval-bell"
        onClick={() => {
          setOpen(true)
          load()
        }}
        title="อีเมลใหม่ที่รออนุมัติ"
        className="relative rounded-lg border border-white/30 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand hover:text-ink hover:border-brand transition-colors"
      >
        🔔 รออนุมัติ
        {pending.length > 0 && (
          <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose px-1 text-xs font-bold text-white">
            {pending.length}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4">
          <div className="w-full max-w-2xl rounded-2xl border-t-8 border-brand bg-surface p-6 text-ink shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">อีเมลที่รออนุมัติ</h2>
              <button onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-lg leading-none hover:bg-brand">
                ✕
              </button>
            </div>
            {error && <p className="mb-3 text-sm text-rose">{error}</p>}
            {pending.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink/70">ไม่มีอีเมลที่รออนุมัติ</p>
            ) : (
              <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-line">
                <table className="w-full text-left text-sm">
                  <thead className="bg-paper text-ink/70">
                    <tr>
                      <th className="px-3 py-2.5 font-semibold">อีเมล</th>
                      <th className="px-3 py-2.5 font-semibold">สมัครเมื่อ</th>
                      <th className="px-3 py-2.5 font-semibold">บทบาท</th>
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((u) => (
                      <tr key={u.id} className="border-t border-line">
                        <td className="px-3 py-2">{u.email}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {new Date(u.created_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                        <td className="px-3 py-2">
                          {!isDeveloper ? (
                            <span className="text-ink/60" title="เฉพาะ Developer กำหนด role ได้">ดูอย่างเดียว (เริ่มต้น)</span>
                          ) : (
                          <select
                            value={picked[u.id] ?? 'viewer'}
                            onChange={(e) => setPicked((p) => ({ ...p, [u.id]: e.target.value as PickRole }))}
                            className="input py-1.5 text-sm"
                          >
                            {roleOptions.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-right">
                          <button
                            disabled={busyId === u.id}
                            onClick={() => decide(u, 'approved')}
                            className="mr-2 rounded-lg border border-ink bg-brand px-3 py-1.5 text-sm font-semibold hover:bg-brand-dark disabled:opacity-50"
                          >
                            ยืนยัน
                          </button>
                          <button
                            disabled={busyId === u.id}
                            onClick={() => {
                              if (window.confirm(`ปฏิเสธ ${u.email} ?`)) decide(u, 'rejected')
                            }}
                            className="rounded-lg border border-ink/40 px-3 py-1.5 text-sm font-medium hover:bg-rose-soft disabled:opacity-50"
                          >
                            ปฏิเสธ
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <button onClick={() => setOpen(false)} className="rounded-lg border border-ink/40 px-4 py-2 text-sm font-medium hover:bg-brand-soft">
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
