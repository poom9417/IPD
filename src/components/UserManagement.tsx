import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { AppUser } from '../lib/types'

interface Props {
  onClose: () => void
}

export default function UserManagement({ onClose }: Props) {
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4">
      <div className="w-full max-w-2xl rounded-2xl bg-surface p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">จัดการสิทธิ์ผู้ใช้</h2>
          <button onClick={onClose} className="text-ink/40 hover:text-ink">
            ✕
          </button>
        </div>

        <p className="mb-3 text-xs text-ink/50">
          รายชื่อจะปรากฏหลังผู้ใช้ login ด้วย Google ครั้งแรกเท่านั้น (ยังไม่ได้ login จะยังไม่มีในลิสต์นี้)
        </p>

        {error && <p className="mb-3 text-sm text-rose">{error}</p>}

        {loading ? (
          <p className="py-8 text-center text-sm text-ink/50">กำลังโหลด…</p>
        ) : users.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink/50">ยังไม่มีผู้ใช้ login เข้าระบบ</p>
        ) : (
          <div className="max-h-96 overflow-y-auto rounded-lg border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-paper text-xs text-ink/50">
                <tr>
                  <th className="px-3 py-2">อีเมล</th>
                  <th className="px-3 py-2">หน่วยงาน</th>
                  <th className="px-3 py-2">สิทธิ์</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-line">
                    <td className="px-3 py-2 text-ink">{u.email}</td>
                    <td className="px-3 py-2">
                      <input
                        defaultValue={u.unit ?? ''}
                        placeholder="เช่น หน่วยเวชระเบียน"
                        onBlur={(e) => {
                          const v = e.target.value.trim() || null
                          if (v !== u.unit) updateUser(u.id, { unit: v })
                        }}
                        className="input py-1 text-xs"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={u.role}
                        disabled={savingId === u.id}
                        onChange={(e) => updateUser(u.id, { role: e.target.value as AppUser['role'] })}
                        className="input py-1 text-xs"
                      >
                        <option value="viewer">ดูอย่างเดียว</option>
                        <option value="user">ผู้ใช้ทั่วไป</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm text-ink/70">
            ปิด
          </button>
        </div>
      </div>
    </div>
  )
}
