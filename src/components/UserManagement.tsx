import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { AppUser } from '../lib/types'
import { useAuth } from '../contexts/AuthContext'

interface Props {
  onClose: () => void
}

export default function UserManagement({ onClose }: Props) {
  const { session, isDeveloper } = useAuth()
  const myId = session?.user.id
  const [users, setUsers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('app_users').select('*').order('created_at')
    if (error) setError(error.message)
    setUsers((data as AppUser[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function updateUser(id: string, patch: Partial<Pick<AppUser, 'role' | 'unit'>>) {
    setSavingId(id)
    setError(null)
    const { error } = await supabase.from('app_users').update(patch).eq('id', id)
    if (error) {
      setError(error.message)
    } else {
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)))
    }
    setSavingId(null)
  }

  async function setApproval(u: AppUser, status: 'pending' | 'approved' | 'rejected') {
    setSavingId(u.id)
    setError(null)
    const { error } = await supabase.rpc('set_user_approval', {
      p_user: u.id,
      p_status: status,
      p_role: status === 'approved' && isDeveloper ? u.role : null,
    })
    if (error) setError(error.message)
    else setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, approval_status: status } : x)))
    setSavingId(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4">
      <div className="w-full max-w-3xl rounded-2xl border-t-8 border-brand bg-surface p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">จัดการสิทธิ์ผู้ใช้</h2>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-lg leading-none text-ink hover:bg-brand">
            ✕
          </button>
        </div>

        <p className="mb-3 text-sm text-ink/70">
          รายชื่อจะปรากฏหลังผู้ใช้ login ด้วย Google ครั้งแรกเท่านั้น (ยังไม่ได้ login จะยังไม่มีในลิสต์นี้)
        </p>

        {error && <p className="mb-3 text-sm text-rose">{error}</p>}

        {loading ? (
          <p className="py-8 text-center text-sm text-ink/70">กำลังโหลด…</p>
        ) : users.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink/70">ยังไม่มีผู้ใช้ login เข้าระบบ</p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-paper text-sm text-ink/70">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">อีเมล</th>
                  <th className="px-3 py-2.5 font-semibold">หน่วยงาน</th>
                  <th className="px-3 py-2.5 font-semibold">สิทธิ์</th>
                  <th className="px-3 py-2.5 font-semibold">การอนุมัติ</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-line">
                    <td className="px-3 py-2 text-ink">{u.email}</td>
                    <td className="px-3 py-2">
                      <input
                        defaultValue={u.unit ?? ''}
                        disabled={u.role === 'developer'}
                        placeholder="เช่น หน่วยเวชระเบียน"
                        onBlur={(e) => {
                          const v = e.target.value.trim() || null
                          if (v !== u.unit) updateUser(u.id, { unit: v })
                        }}
                        className="input py-1.5 text-sm"
                      />
                    </td>
                    <td className="px-3 py-2">
                      {u.role === 'developer' ? (
                        <span
                          title="บัญชี developer ถูกล็อก — ไม่สามารถแก้ไขสิทธิ์จากหน้านี้ได้"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-sm font-semibold text-ink"
                        >
                          🔒 Developer
                        </span>
                      ) : (
                      <select
                        value={u.role}
                        disabled={savingId === u.id || !isDeveloper || u.id === myId}
                        title={!isDeveloper ? 'เฉพาะ Developer กำหนด role ได้' : u.id === myId ? 'เปลี่ยน role ของตัวเองไม่ได้' : undefined}
                        onChange={(e) => updateUser(u.id, { role: e.target.value as AppUser['role'] })}
                        className="input py-1.5 text-sm"
                      >
                        <option value="viewer">ดูอย่างเดียว</option>
                        <option value="user">ผู้ใช้ทั่วไป</option>
                        <option value="audit">Audit</option>
                        <option value="admin">Admin</option>
                      </select>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {u.role === 'developer' ? (
                        <span className="text-sm text-ink/60">—</span>
                      ) : (u.approval_status ?? 'approved') === 'approved' ? (
                        <button
                          disabled={savingId === u.id}
                          onClick={() => {
                            if (window.confirm(`เปลี่ยน ${u.email} กลับเป็น "รออนุมัติ" ? (จะเข้าใช้งานไม่ได้จนกว่าจะอนุมัติใหม่)`))
                              setApproval(u, 'pending')
                          }}
                          className="rounded-lg border border-ink/40 px-2.5 py-1 text-sm font-medium hover:bg-rose-soft disabled:opacity-50"
                        >
                          ✓ อนุมัติแล้ว · ยกเลิก
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-sm font-semibold text-rose">
                            {u.approval_status === 'rejected' ? 'ถูกปฏิเสธ' : 'รออนุมัติ'}
                          </span>
                          <button
                            disabled={savingId === u.id}
                            onClick={() => setApproval(u, 'approved')}
                            className="rounded-lg border border-ink bg-brand px-2.5 py-1 text-sm font-semibold hover:bg-brand-dark disabled:opacity-50"
                          >
                            อนุมัติ
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded-lg border border-ink/40 px-4 py-2 text-sm font-medium text-ink hover:bg-brand-soft">
            ปิด
          </button>
        </div>
      </div>
    </div>
  )
}
