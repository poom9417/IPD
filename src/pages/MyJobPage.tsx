import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { pairKey } from '../lib/pairKey'
import type { CoverageAssignment, CoveragePayerPair } from '../lib/types'

export default function MyJobPage() {
  const { session, role } = useAuth()
  const myId = session?.user.id ?? ''
  // เฉพาะ admin / user เลือกสิทธิได้ (audit และ viewer ไม่มีหน้านี้ — ฐานข้อมูลบล็อกซ้ำอีกชั้น)
  const canEdit = role === 'admin' || role === 'user'

  const [pairs, setPairs] = useState<CoveragePayerPair[]>([])
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
      supabase.from('coverage_payer_pairs').select('*').order('coverage_code').order('payer_id'),
      supabase.from('coverage_assignments').select('coverage_code, payer_id, user_id, user_email'),
    ])
    if (cov.error || asg.error) {
      setMessage({ ok: false, text: cov.error?.message ?? asg.error?.message ?? 'โหลดข้อมูลไม่สำเร็จ' })
    }
    const list = (asg.data as CoverageAssignment[]) ?? []
    const mine = new Set(list.filter((a) => a.user_id === myId).map((a) => pairKey(a.coverage_code, a.payer_id)))
    setPairs((cov.data as CoveragePayerPair[]) ?? [])
    setAssignments(list)
    setSelected(new Set(mine))
    setSaved(new Set(mine))
    setLoading(false)
  }

  useEffect(() => {
    if (myId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId])

  // 1 คู่ สิทธิ+payer มีผู้ดูแลได้คนเดียว — คู่ที่คนอื่นดูแลอยู่ (key → อีเมลของเขา)
  const ownerByPair = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of assignments) {
      if (a.user_id === myId) continue
      m.set(pairKey(a.coverage_code, a.payer_id), a.user_email ?? '—')
    }
    return m
  }, [assignments, myId])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return pairs
    return pairs.filter(
      (c) =>
        c.coverage_code.toLowerCase().includes(q) ||
        (c.coverage_name ?? '').toLowerCase().includes(q) ||
        c.payer_id.toLowerCase().includes(q) ||
        (c.payer_name ?? '').toLowerCase().includes(q),
    )
  }, [pairs, query])

  // เลือกได้เฉพาะคู่ที่ว่าง หรือของตัวเอง
  const selectableVisible = useMemo(
    () => visible.filter((c) => !ownerByPair.has(pairKey(c.coverage_code, c.payer_id))),
    [visible, ownerByPair],
  )

  // สิทธิที่มีหลาย payer → มีปุ่ม "เลือกทั้งสิทธิ" ที่แถวแรกของกลุ่ม
  const payerCountByCoverage = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of pairs) m.set(c.coverage_code, (m.get(c.coverage_code) ?? 0) + 1)
    return m
  }, [pairs])

  const dirty = selected.size !== saved.size || [...selected].some((c) => !saved.has(c))

  function toggle(key: string) {
    if (ownerByPair.has(key)) return
    setMessage(null)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function selectVisible() {
    setSelected((prev) => new Set([...prev, ...selectableVisible.map((c) => pairKey(c.coverage_code, c.payer_id))]))
  }

  // เลือกทุก payer ที่ว่างของสิทธิเดียวกัน (เช่น ONHSI ทั้ง 15251 และ 50087)
  function selectWholeCoverage(code: string) {
    setMessage(null)
    setSelected((prev) => {
      const next = new Set(prev)
      for (const c of pairs) {
        const k = pairKey(c.coverage_code, c.payer_id)
        if (c.coverage_code === code && !ownerByPair.has(k)) next.add(k)
      }
      return next
    })
  }

  async function save() {
    setSaving(true)
    setMessage(null)
    // ฟังก์ชันฝั่งฐานข้อมูลคืน "รายการสิทธิที่จองไม่สำเร็จ" (มีคนอื่นดูแลแล้ว เช่น กดตัดหน้ากัน)
    const payload = [...selected].map((k) => {
      const [coverage_code, payer_id] = k.split('|')
      return { coverage_code, payer_id }
    })
    const { data, error } = await supabase.rpc('set_my_responsibilities', { pairs: payload })
    setSaving(false)
    if (error) {
      setMessage({ ok: false, text: `บันทึกไม่สำเร็จ: ${error.message}` })
      return
    }
    const refused = ((data as { coverage_code: string; payer_id: string }[] | null) ?? []).map(
      (r) => `${r.coverage_code} (${r.payer_id})`,
    )
    if (refused.length > 0) {
      setMessage({
        ok: false,
        text: `${refused.join(', ')} มีผู้ดูแลอยู่แล้ว จึงไม่ถูกบันทึก (อาจมีคนเลือกตัดหน้า) — สิทธิที่เหลือบันทึกแล้ว`,
      })
    } else {
      setMessage({ ok: true, text: `บันทึกแล้ว — คุณดูแล ${selected.size} รายการ (สิทธิ+ผู้จ่าย)` })
    }
    await load()
  }

  const unassigned = pairs.filter((c) => {
    const k = pairKey(c.coverage_code, c.payer_id)
    return !selected.has(k) && !ownerByPair.has(k)
  }).length

  return (
    <main className="w-full space-y-5 px-4 py-6 sm:px-8">
      <div>
        <h1 className="text-xl font-bold text-ink">My claim — สิทธิที่ฉันดูแล</h1>
        <p className="mt-1 text-sm text-ink/70">
          เลือกสิทธิการรักษาที่คุณรับผิดชอบได้หลายรายการ โดยแยกตามผู้จ่าย (payer) เช่น GGO กรมบัญชีกลาง กับ GGO กรุงเทพมหานคร เป็นคนละรายการ
          แต่ละรายการมีผู้ดูแลได้ 1 คนเท่านั้น รายการที่มีคนดูแลแล้วจะเลือกไม่ได้ เมื่อบันทึกแล้วหน้า Mine และ Code C จะมีปุ่ม “เฉพาะสิทธิของฉัน” ให้กรองเคสทันที
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-line border-l-8 border-l-brand bg-surface px-5 py-4">
          <p className="text-sm font-medium text-ink/70">รายการที่ฉันดูแล</p>
          <p className="mt-1 text-3xl font-bold text-ink">{selected.size}</p>
        </div>
        <div className="rounded-xl border border-line border-l-8 border-l-brand bg-surface px-5 py-4">
          <p className="text-sm font-medium text-ink/70">สิทธิ+ผู้จ่าย ทั้งหมดในระบบ</p>
          <p className="mt-1 text-3xl font-bold text-ink">{pairs.length}</p>
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
          placeholder="ค้นหารหัส/ชื่อสิทธิ หรือรหัส/ชื่อผู้จ่าย…"
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
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="bg-brand text-[13px] text-ink">
                <th className="w-14 px-3 py-3 font-semibold">ดูแล</th>
                <th className="whitespace-nowrap px-3 py-3 font-semibold">รหัสสิทธิ</th>
                <th className="px-3 py-3 font-semibold">ชื่อสิทธิ</th>
                <th className="px-3 py-3 font-semibold">ผู้จ่าย (payer)</th>
                <th className="whitespace-nowrap px-3 py-3 text-right font-semibold">จำนวนเคส</th>
                <th className="px-3 py-3 font-semibold">ผู้ดูแล</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c, i) => {
                const key = pairKey(c.coverage_code, c.payer_id)
                const on = selected.has(key)
                const owner = ownerByPair.get(key)
                const firstOfGroup = i === 0 || visible[i - 1].coverage_code !== c.coverage_code
                const multi = (payerCountByCoverage.get(c.coverage_code) ?? 0) > 1
                const locked = owner !== undefined
                const clickable = canEdit && !locked
                return (
                  <tr
                    key={key}
                    onClick={() => clickable && toggle(key)}
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
                        onChange={() => toggle(key)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4 accent-black"
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[13px] font-semibold text-ink">
                      {c.coverage_code}
                      {canEdit && multi && firstOfGroup && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            selectWholeCoverage(c.coverage_code)
                          }}
                          className="ml-2 rounded border border-ink/30 px-2 py-0.5 font-sans text-xs font-medium hover:bg-brand-soft"
                        >
                          เลือกทั้งสิทธิ
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-ink">{c.coverage_name}</td>
                    <td className="px-3 py-2.5 text-ink">
                      <span className="font-mono text-[13px]">{c.payer_id}</span> {c.payer_name ?? ''}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink/80">{c.case_count.toLocaleString()}</td>
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
                  <td colSpan={6} className="px-3 py-8 text-center text-sm text-ink/60">
                    ไม่พบรายการที่ค้นหา
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
