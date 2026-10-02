import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import type { CoverageAssignment, CoverageMaster } from '../lib/types'

export default function MyJobPage() {
  const { session, role } = useAuth()
  const myId = session?.user.id ?? ''
  // เฉพาะ admin / user เลือกสิทธิได้ (audit และ viewer ไม่มีหน้านี้ — ฐานข้อมูลบล็อกซ้ำอีกชั้น)
  const canEdit = role === 'admin' || role === 'user'

  const [coverages, setCoverages] = useState<CoverageMaster[]>([])
  const [assignments, setAssignments] = useState<CoverageAssignment[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function load() {
    setLoading(true)
    const [cov, asg] = await Promise.all([
      supabase.from('coverage_master').select('*').order('coverage_code'),
      supabase.from('coverage_assignments').select('coverage_code, user_id, user_email'),
    ])
    if (cov.error || asg.error) {
      setMessage({ ok: false, text: cov.error?.message ?? asg.error?.message ?? 'โหลดข้อมูลไม่สำเร็จ' })
    }
    const list = (asg.data as CoverageAssignment[]) ?? []
    const mine = new Set(list.filter((a) => a.user_id === myId).map((a) => a.coverage_code))
    setCoverages((cov.data as CoverageMaster[]) ?? [])
    setAssignments(list)
    setSelected(new Set(mine))
    setSaved(new Set(mine))
    setLoading(false)
  }

  useEffect(() => {
    if (myId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId])

  // 1 สิทธิมีผู้ดูแลได้คนเดียว — สิทธิที่คนอื่นดูแลอยู่ (code → อีเมลของเขา)
  const ownerByCoverage = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of assignments) {
      if (a.user_id === myId) continue
      m.set(a.coverage_code, a.user_email ?? '—')
    }
    return m
  }, [assignments, myId])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return coverages
    return coverages.filter(
      (c) => c.coverage_code.toLowerCase().includes(q) || c.coverage_name.toLowerCase().includes(q),
    )
  }, [coverages, query])

  // เลือกได้เฉพาะสิทธิที่ว่าง หรือของตัวเอง
  const selectableVisible = useMemo(
    () => visible.filter((c) => !ownerByCoverage.has(c.coverage_code)),
    [visible, ownerByCoverage],
  )

  const dirty = selected.size !== saved.size || [...selected].some((c) => !saved.has(c))

  function toggle(code: string) {
    if (ownerByCoverage.has(code)) return
    setMessage(null)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  function selectVisible() {
    setSelected((prev) => new Set([...prev, ...selectableVisible.map((c) => c.coverage_code)]))
  }

  async function save() {
    setSaving(true)
    setMessage(null)
    // ฟังก์ชันฝั่งฐานข้อมูลคืน "รายการสิทธิที่จองไม่สำเร็จ" (มีคนอื่นดูแลแล้ว เช่น กดตัดหน้ากัน)
    const { data, error } = await supabase.rpc('set_my_coverages', { codes: [...selected] })
    setSaving(false)
    if (error) {
      setMessage({ ok: false, text: `บันทึกไม่สำเร็จ: ${error.message}` })
      return
    }
    const refused = (data as string[] | null) ?? []
    if (refused.length > 0) {
      setMessage({
        ok: false,
        text: `สิทธิ ${refused.join(', ')} มีผู้ดูแลอยู่แล้ว จึงไม่ถูกบันทึก (อาจมีคนเลือกตัดหน้า) — สิทธิที่เหลือบันทึกแล้ว`,
      })
    } else {
      setMessage({ ok: true, text: `บันทึกแล้ว — คุณดูแล ${selected.size} สิทธิ` })
    }
    await load()
  }

  const unassigned = coverages.filter(
    (c) => !selected.has(c.coverage_code) && !ownerByCoverage.has(c.coverage_code),
  ).length

  return (
    <main className="w-full space-y-5 px-4 py-6 sm:px-8">
      <div>
        <h1 className="text-xl font-bold text-ink">My claim — สิทธิที่ฉันดูแล</h1>
        <p className="mt-1 text-sm text-ink/70">
          เลือกสิทธิการรักษาที่คุณรับผิดชอบได้หลายรายการ แต่ 1 สิทธิมีผู้ดูแลได้ 1 คนเท่านั้น
          สิทธิที่มีคนดูแลแล้วจะเลือกไม่ได้ เมื่อบันทึกแล้วหน้า Mine และ Code C จะมีปุ่ม “เฉพาะสิทธิของฉัน” ให้กรองเคสทันที
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-line border-l-8 border-l-brand bg-surface px-5 py-4">
          <p className="text-sm font-medium text-ink/70">สิทธิที่ฉันดูแล</p>
          <p className="mt-1 text-3xl font-bold text-ink">{selected.size}</p>
        </div>
        <div className="rounded-xl border border-line border-l-8 border-l-brand bg-surface px-5 py-4">
          <p className="text-sm font-medium text-ink/70">สิทธิทั้งหมดในระบบ</p>
          <p className="mt-1 text-3xl font-bold text-ink">{coverages.length}</p>
        </div>
        <div className="rounded-xl border border-line border-l-8 border-l-brand bg-surface px-5 py-4">
          <p className="text-sm font-medium text-ink/70">ยังไม่มีผู้ดูแล</p>
          <p className="mt-1 text-3xl font-bold text-ink">{unassigned}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหารหัสหรือชื่อสิทธิ…"
          className="input sm:max-w-sm"
        />
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={selectVisible}
              disabled={selectableVisible.length === 0}
              className="rounded-lg border border-ink/30 px-4 py-2 text-sm font-medium text-ink hover:bg-brand-soft hover:border-ink disabled:opacity-40"
            >
              {query ? `เลือกที่ค้นเจอ (${selectableVisible.length})` : 'เลือกที่ว่างทั้งหมด'}
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="rounded-lg border border-ink/30 px-4 py-2 text-sm font-medium text-ink hover:bg-brand-soft hover:border-ink"
            >
              ล้าง
            </button>
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-ink hover:bg-brand-dark disabled:opacity-40"
            >
              {saving ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
          </div>
        )}
      </div>

      {message && (
        <p className={'text-sm ' + (message.ok ? 'text-ink font-semibold' : 'text-rose')}>{message.text}</p>
      )}
      {!canEdit && <p className="text-sm text-ink/70">บัญชีนี้กำหนดสิทธิที่ดูแลไม่ได้</p>}

      {loading ? (
        <div className="rounded-xl border border-line bg-surface p-8 text-center text-sm text-ink/60">กำลังโหลดข้อมูล…</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="bg-brand text-[13px] text-ink">
                <th className="w-14 px-3 py-3 font-semibold">ดูแล</th>
                <th className="whitespace-nowrap px-3 py-3 font-semibold">รหัสสิทธิ</th>
                <th className="px-3 py-3 font-semibold">ชื่อสิทธิ</th>
                <th className="px-3 py-3 font-semibold">ผู้ดูแล</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => {
                const on = selected.has(c.coverage_code)
                const owner = ownerByCoverage.get(c.coverage_code)
                const locked = owner !== undefined
                const clickable = canEdit && !locked
                return (
                  <tr
                    key={c.coverage_code}
                    onClick={() => clickable && toggle(c.coverage_code)}
                    className={
                      'border-b border-line last:border-0 ' +
                      (clickable ? 'cursor-pointer ' : '') +
                      (locked
                        ? 'bg-paper/60 text-ink/50'
                        : on
                          ? 'bg-brand-soft/60 hover:bg-brand-soft'
                          : 'hover:bg-paper')
                    }
                  >
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!clickable}
                        onChange={() => toggle(c.coverage_code)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4 accent-black"
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[13px] font-semibold text-ink">
                      {c.coverage_code}
                    </td>
                    <td className="px-3 py-2.5 text-ink">{c.coverage_name}</td>
                    <td className="px-3 py-2.5 text-ink/80">
                      {locked ? (
                        owner
                      ) : on ? (
                        <span className="font-semibold text-ink">ฉัน</span>
                      ) : (
                        <span className="text-ink/40">ว่าง</span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-sm text-ink/60">
                    ไม่พบสิทธิที่ค้นหา
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
