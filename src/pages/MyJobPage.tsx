import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { pairKey } from '../lib/pairKey'
import type { AssignableUser, AssignmentRequest, CoverageAssignment, CoveragePayerPair } from '../lib/types'

type Mode = 'claim' | 'assign'

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', user: 'User', developer: 'Developer' }
const nameOf = (email: string | null | undefined) => (email ? email.split('@')[0] : '—')

function LockIcon() {
  return (
    <svg className="inline h-3.5 w-3.5 align-[-2px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </svg>
  )
}

/** กล่องยืนยันก่อนบันทึก — Enter = ตกลง, Esc = ยกเลิก */
function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string
  children: React.ReactNode
  confirmLabel: string
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !busy) onConfirm()
      else if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onConfirm, onCancel])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-xl">
        <h2 className="text-base font-bold text-ink">{title}</h2>
        <div className="mt-2 space-y-1 text-sm text-ink/80">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-ink/30 px-4 py-2 text-sm font-medium text-ink hover:bg-brand-soft"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-ink ring-1 ring-ink/30 hover:bg-brand-dark disabled:opacity-40"
          >
            {busy ? 'กำลังบันทึก…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function MyJobPage() {
  const { session, role, canAssign } = useAuth()
  const myId = session?.user.id ?? ''
  // รับสิทธิให้ตัวเอง: admin / user  |  เลือกสิทธิให้ผู้อื่น: audit / developer (ฐานข้อมูลเช็ค role จริงซ้ำ)
  const canClaim = role === 'admin' || role === 'user'

  const [mode, setMode] = useState<Mode>(canClaim ? 'claim' : 'assign')
  const activeMode: Mode = mode === 'assign' && canAssign ? 'assign' : canClaim ? 'claim' : canAssign ? 'assign' : 'claim'

  const [pairs, setPairs] = useState<CoveragePayerPair[]>([])
  const [assignments, setAssignments] = useState<CoverageAssignment[]>([])
  const [requests, setRequests] = useState<AssignmentRequest[]>([])
  const [users, setUsers] = useState<AssignableUser[]>([])
  const [saved, setSaved] = useState<Set<string>>(new Set()) // ที่ฉันรับไว้แล้ว (ล็อก ยกเลิกเองไม่ได้)
  const [selected, setSelected] = useState<Set<string>>(new Set()) // เลือกเพิ่มเอง (ยังไม่บันทึก)
  const [assignSel, setAssignSel] = useState<Set<string>>(new Set()) // เลือกให้ผู้อื่น (ยังไม่ส่ง)
  const [recipient, setRecipient] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState<Mode | null>(null)
  const [setupMissing, setSetupMissing] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function load() {
    setLoading(true)
    const [cov, asg, req] = await Promise.all([
      supabase.from('coverage_payer_pairs').select('*').order('coverage_code').order('payer_id'),
      supabase.from('coverage_assignments').select('coverage_code, payer_id, user_id, user_email'),
      supabase
        .from('assignment_requests')
        .select('id, coverage_code, payer_id, user_id, user_email, assigned_by_email, created_at')
        .eq('status', 'pending'),
    ])
    if (cov.error || asg.error) {
      setMessage({ ok: false, text: cov.error?.message ?? asg.error?.message ?? 'โหลดข้อมูลไม่สำเร็จ' })
    }
    // ตารางคำขอยังไม่มี (ยังไม่ได้รัน SQL) → ใช้หน้านี้ต่อได้ แต่ฟังก์ชันมอบหมาย/ล็อกต้องรัน SQL ก่อน
    setSetupMissing(!!req.error)
    setRequests(req.error ? [] : ((req.data as AssignmentRequest[]) ?? []))

    const list = (asg.data as CoverageAssignment[]) ?? []
    setPairs((cov.data as CoveragePayerPair[]) ?? [])
    setAssignments(list)
    setSaved(new Set(list.filter((a) => a.user_id === myId).map((a) => pairKey(a.coverage_code, a.payer_id))))
    setSelected(new Set())
    setAssignSel(new Set())

    if (canAssign) {
      const u = await supabase.rpc('list_assignable_users')
      if (!u.error) setUsers((u.data as AssignableUser[]) ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    if (myId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId, canAssign])

  // 1 คู่ สิทธิ+payer มีผู้ดูแลได้คนเดียว — คู่ที่คนอื่นดูแลอยู่ (key → อีเมลของเขา)
  const ownerByPair = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of assignments) {
      if (a.user_id === myId) continue
      m.set(pairKey(a.coverage_code, a.payer_id), a.user_email ?? '—')
    }
    return m
  }, [assignments, myId])

  // คำขอที่รอผู้รับยืนยัน (key → คำขอ) — กันไม่ให้คนอื่นเลือกซ้ำ
  const pendingByPair = useMemo(() => {
    const m = new Map<string, AssignmentRequest>()
    for (const r of requests) m.set(pairKey(r.coverage_code, r.payer_id), r)
    return m
  }, [requests])

  // ว่าง = ไม่มีใครดูแล ไม่ใช่ของฉัน และไม่มีคำขอรอยืนยัน
  const isFree = (key: string) => !ownerByPair.has(key) && !saved.has(key) && !pendingByPair.has(key)

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

  const selectableVisible = useMemo(
    () => visible.filter((c) => isFree(pairKey(c.coverage_code, c.payer_id))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, ownerByPair, pendingByPair, saved],
  )

  // สิทธิที่มีหลาย payer → มีปุ่ม "เลือกทั้งสิทธิ" ที่แถวแรกของกลุ่ม
  const payerCountByCoverage = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of pairs) m.set(c.coverage_code, (m.get(c.coverage_code) ?? 0) + 1)
    return m
  }, [pairs])

  const activeSel = activeMode === 'claim' ? selected : assignSel
  const setActiveSel = activeMode === 'claim' ? setSelected : setAssignSel
  const recipientUsers = useMemo(() => users.filter((u) => u.id !== myId), [users, myId])
  const recipientUser = recipientUsers.find((u) => u.id === recipient)

  function toggle(key: string) {
    if (!isFree(key)) return
    setMessage(null)
    setActiveSel((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function selectVisible() {
    setMessage(null)
    setActiveSel((prev) => new Set([...prev, ...selectableVisible.map((c) => pairKey(c.coverage_code, c.payer_id))]))
  }

  // เลือกทุก payer ที่ว่างของสิทธิเดียวกัน (เช่น ONHSI ทั้ง 15251 และ 50087)
  function selectWholeCoverage(code: string) {
    setMessage(null)
    setActiveSel((prev) => {
      const next = new Set(prev)
      for (const c of pairs) {
        const k = pairKey(c.coverage_code, c.payer_id)
        if (c.coverage_code === code && isFree(k)) next.add(k)
      }
      return next
    })
  }

  const toPayload = (keys: Iterable<string>) =>
    [...keys].map((k) => {
      const [coverage_code, payer_id] = k.split('|')
      return { coverage_code, payer_id }
    })

  // รับสิทธิให้ตัวเอง — บันทึกแล้วยกเลิกเองไม่ได้ (ฟังก์ชันฝั่งฐานข้อมูล "เพิ่มอย่างเดียว")
  async function doClaim() {
    setSaving(true)
    setMessage(null)
    // ส่ง "ที่รับไว้แล้ว + เลือกใหม่" ครบทั้งชุด — ฟังก์ชันใหม่เพิ่มอย่างเดียวอยู่แล้ว แต่ถ้าหน้าเว็บขึ้นก่อนรัน SQL
    // ฟังก์ชันเดิมจะลบรายการที่ไม่อยู่ในชุดนี้ การส่งครบชุดจึงไม่ทำให้สิทธิเดิมหายไม่ว่าลำดับ deploy จะเป็นแบบไหน
    const { data, error } = await supabase.rpc('set_my_responsibilities', {
      pairs: toPayload([...saved, ...selected]),
    })
    setSaving(false)
    setConfirm(null)
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
        text: `${refused.join(', ')} มีผู้ดูแลหรือรอคนอื่นยืนยันอยู่แล้ว จึงไม่ถูกบันทึก (อาจมีคนเลือกตัดหน้า) — รายการที่เหลือบันทึกแล้ว`,
      })
    } else {
      setMessage({ ok: true, text: `บันทึกแล้ว — คุณรับสิทธิเพิ่ม ${selected.size} รายการ` })
    }
    await load()
  }

  // Audit / Developer: ส่งคำขอให้ผู้รับยืนยัน
  async function doAssign() {
    if (!recipient) return
    setSaving(true)
    setMessage(null)
    const { data, error } = await supabase.rpc('assign_responsibilities', {
      p_user: recipient,
      pairs: toPayload(assignSel),
    })
    setSaving(false)
    setConfirm(null)
    if (error) {
      setMessage({ ok: false, text: `ส่งคำขอไม่สำเร็จ: ${error.message}` })
      return
    }
    const res = data as { created?: number; refused?: { coverage_code: string; payer_id: string; reason: string }[] } | null
    const refused = (res?.refused ?? []).map((r) => `${r.coverage_code} (${r.payer_id}) — ${r.reason}`)
    const created = res?.created ?? 0
    if (refused.length > 0) {
      setMessage({
        ok: created > 0,
        text: `ส่งคำขอให้ ${nameOf(recipientUser?.email)} ${created} รายการ · ส่งไม่ได้: ${refused.join('; ')}`,
      })
    } else {
      setMessage({
        ok: true,
        text: `ส่งคำขอให้ ${nameOf(recipientUser?.email)} แล้ว ${created} รายการ — รอผู้รับกดยืนยันที่หน้าหลัก`,
      })
    }
    await load()
  }

  async function cancelRequest(id: number) {
    setMessage(null)
    const { error } = await supabase.rpc('cancel_assignment_requests', { p_ids: [id] })
    if (error) {
      setMessage({ ok: false, text: `ยกเลิกคำขอไม่สำเร็จ: ${error.message}` })
      return
    }
    setMessage({ ok: true, text: 'ยกเลิกคำขอแล้ว — สิทธิกลับไปเป็นว่าง' })
    await load()
  }

  const freeCount = pairs.filter((c) => isFree(pairKey(c.coverage_code, c.payer_id))).length
  const actionDisabled =
    saving || activeSel.size === 0 || (activeMode === 'assign' && (!recipient || setupMissing)) || (activeMode === 'claim' && setupMissing)

  const cards: { label: string; value: string }[] = [
    ...(canClaim
      ? [{ label: 'รายการที่ฉันดูแล', value: saved.size.toLocaleString() + (selected.size ? ` (+${selected.size} เลือกใหม่)` : '') }]
      : []),
    { label: 'สิทธิ+ผู้จ่าย ทั้งหมดในระบบ', value: pairs.length.toLocaleString() },
    { label: 'ยังไม่มีผู้ดูแล', value: freeCount.toLocaleString() },
    { label: 'รอผู้รับยืนยัน', value: requests.length.toLocaleString() },
  ]

  return (
    <main className="w-full space-y-5 px-4 py-6 sm:px-8">
      <div>
        <h1 className="text-xl font-bold text-ink">
          {activeMode === 'assign' ? 'My claim — เลือกสิทธิให้ผู้ดูแล' : 'My claim — สิทธิที่ฉันดูแล'}
        </h1>
        <p className="mt-1 text-sm text-ink/70">
          {activeMode === 'assign' ? (
            <>
              เลือกสิทธิ+ผู้จ่ายที่ยังไม่มีผู้ดูแล แล้วเลือกผู้รับ ระบบจะส่งแจ้งเตือนไปที่หน้าหลักของผู้รับให้กดยืนยัน
              จนกว่าผู้รับจะยืนยัน รายการนั้นจะถูกจองไว้และคนอื่นเลือกซ้ำไม่ได้
            </>
          ) : (
            <>
              เลือกสิทธิการรักษาที่คุณรับผิดชอบได้หลายรายการ โดยแยกตามผู้จ่าย (payer) เช่น GGO กรมบัญชีกลาง กับ GGO กรุงเทพมหานคร
              เป็นคนละรายการ แต่ละรายการมีผู้ดูแลได้ 1 คนเท่านั้น <b className="font-semibold text-ink">เมื่อบันทึกแล้วจะเอาออกเองไม่ได้</b>{' '}
              หน้า Mine และ Code C จะมีปุ่ม “เฉพาะสิทธิของฉัน” ให้กรองเคสทันที
            </>
          )}
        </p>
      </div>

      {canClaim && canAssign && (
        <div className="inline-flex rounded-lg border border-ink/30 p-0.5 text-sm" role="tablist">
          {(
            [
              ['claim', 'รับสิทธิให้ตัวเอง'],
              ['assign', 'เลือกสิทธิให้ผู้อื่น'],
            ] as [Mode, string][]
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={activeMode === m}
              onClick={() => {
                setMode(m)
                setMessage(null)
              }}
              className={
                'rounded-md px-4 py-1.5 font-medium transition-colors ' +
                (activeMode === m ? 'bg-brand text-ink' : 'text-ink/70 hover:bg-brand-soft')
              }
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {setupMissing && (
        <p className="rounded-lg border border-line border-l-8 border-l-alert bg-surface px-4 py-3 text-sm text-ink">
          ฐานข้อมูลยังไม่มีตารางคำขอรอยืนยัน — ต้องรันไฟล์ <span className="font-mono">add_claim_assignment.sql</span> ใน Supabase SQL Editor
          ก่อน จึงจะบันทึก/มอบหมายสิทธิได้ตามระบบใหม่
        </p>
      )}

      <div data-tour="claim-stats" className={'grid grid-cols-1 gap-4 sm:grid-cols-2 ' + (cards.length === 4 ? 'xl:grid-cols-4' : 'xl:grid-cols-3')}>
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-line border-l-8 border-l-brand bg-surface px-5 py-4">
            <p className="text-sm font-medium text-ink/70">{c.label}</p>
            <p className="mt-1 text-3xl font-bold text-ink">{c.value}</p>
          </div>
        ))}
      </div>

      <div data-tour="claim-toolbar" className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหารหัส/ชื่อสิทธิ หรือรหัส/ชื่อผู้จ่าย…"
          className="input lg:max-w-sm"
        />
        {(canClaim || canAssign) && (
          <div className="flex flex-wrap items-center gap-2">
            {activeMode === 'assign' && (
              <select
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                aria-label="ผู้รับ"
                className="rounded-lg border border-ink/25 bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/60"
              >
                <option value="">เลือกผู้รับ…</option>
                {recipientUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.email.split('@')[0]}
                    {u.unit ? ` · ${u.unit}` : ''} ({ROLE_LABEL[u.role] ?? u.role})
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={selectVisible}
              disabled={selectableVisible.length === 0}
              className="rounded-lg border border-ink/30 px-4 py-2 text-sm font-medium text-ink hover:bg-brand-soft hover:border-ink disabled:opacity-40"
            >
              {query ? `เลือกที่ค้นเจอ (${selectableVisible.length})` : 'เลือกที่ว่างทั้งหมด'}
            </button>
            <button
              onClick={() => setActiveSel(new Set())}
              disabled={activeSel.size === 0}
              className="rounded-lg border border-ink/30 px-4 py-2 text-sm font-medium text-ink hover:bg-brand-soft hover:border-ink disabled:opacity-40"
            >
              {activeMode === 'claim' ? 'ล้างที่เลือกใหม่' : 'ล้าง'}
            </button>
            <button
              onClick={() => setConfirm(activeMode)}
              disabled={actionDisabled}
              className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-ink hover:bg-brand-dark disabled:opacity-40"
            >
              {activeMode === 'claim' ? 'บันทึก' : `มอบหมาย${assignSel.size ? ` (${assignSel.size})` : ''}`}
            </button>
          </div>
        )}
      </div>

      {message && (
        <p className={'text-sm ' + (message.ok ? 'text-ink font-semibold' : 'text-rose')}>{message.text}</p>
      )}
      {!canClaim && !canAssign && <p className="text-sm text-ink/70">บัญชีนี้กำหนดสิทธิที่ดูแลไม่ได้</p>}

      {loading ? (
        <div className="rounded-xl border border-line bg-surface p-8 text-center text-sm text-ink/60">กำลังโหลดข้อมูล…</div>
      ) : (
        <div data-tour="claim-table" className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="bg-brand text-[13px] text-ink">
                <th className="w-14 px-3 py-3 font-semibold">{activeMode === 'claim' ? 'ดูแล' : 'เลือก'}</th>
                <th className="whitespace-nowrap px-3 py-3 font-semibold">รหัสสิทธิ</th>
                <th className="px-3 py-3 font-semibold">ชื่อสิทธิ</th>
                <th className="px-3 py-3 font-semibold">ผู้จ่าย (payer)</th>
                <th className="whitespace-nowrap px-3 py-3 text-right font-semibold">จำนวนเคส</th>
                <th className="px-3 py-3 font-semibold">ผู้ดูแล / สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c, i) => {
                const key = pairKey(c.coverage_code, c.payer_id)
                const mineSaved = saved.has(key)
                const picked = activeSel.has(key)
                const owner = ownerByPair.get(key)
                const pending = pendingByPair.get(key)
                const firstOfGroup = i === 0 || visible[i - 1].coverage_code !== c.coverage_code
                const multi = (payerCountByCoverage.get(c.coverage_code) ?? 0) > 1
                const free = isFree(key)
                const interactive = (canClaim || canAssign) && free
                const dim = owner !== undefined || pending !== undefined
                // ช่องติ๊ก: รายการที่ฉันรับแล้ว (โหมดรับสิทธิ) ติ๊กค้างและกดเอาออกไม่ได้
                const checked = activeMode === 'claim' ? mineSaved || picked : picked
                return (
                  <tr
                    key={key}
                    onClick={() => interactive && toggle(key)}
                    className={
                      'border-b border-line last:border-0 ' +
                      (interactive ? 'cursor-pointer ' : '') +
                      (dim
                        ? 'bg-paper/60 text-ink/50'
                        : mineSaved
                          ? 'bg-brand-soft/40'
                          : picked
                            ? 'bg-brand-soft/60 hover:bg-brand-soft'
                            : 'hover:bg-paper')
                    }
                  >
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!interactive}
                        onChange={() => toggle(key)}
                        onClick={(e) => e.stopPropagation()}
                        title={mineSaved ? 'รับสิทธิแล้ว — ยกเลิกเองไม่ได้' : undefined}
                        className="h-4 w-4 accent-black"
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[13px] font-semibold text-ink">
                      {c.coverage_code}
                      {(canClaim || canAssign) && multi && firstOfGroup && (
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
                      {owner !== undefined ? (
                        owner
                      ) : mineSaved ? (
                        <span className="font-semibold text-ink">
                          ฉัน <LockIcon /> <span className="font-normal text-ink/60">รับแล้ว</span>
                        </span>
                      ) : pending ? (
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-[13px] font-semibold text-ink">
                            รอ {nameOf(pending.user_email)} ยืนยัน
                          </span>
                          <span className="text-xs text-ink/50">เลือกโดย {nameOf(pending.assigned_by_email)}</span>
                          {canAssign && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                cancelRequest(pending.id)
                              }}
                              className="rounded border border-ink/30 px-2 py-0.5 text-xs font-medium text-ink hover:bg-brand-soft"
                            >
                              ยกเลิกคำขอ
                            </button>
                          )}
                        </span>
                      ) : picked ? (
                        <span className="font-semibold text-ink">
                          {activeMode === 'claim' ? 'ฉัน (ยังไม่บันทึก)' : `จะมอบหมายให้ ${nameOf(recipientUser?.email) === '—' ? 'ผู้รับ' : nameOf(recipientUser?.email)}`}
                        </span>
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

      {confirm === 'claim' && (
        <ConfirmDialog
          title={`ยืนยันรับสิทธิ ${selected.size} รายการ?`}
          confirmLabel="ยืนยันรับสิทธิ"
          busy={saving}
          onConfirm={doClaim}
          onCancel={() => setConfirm(null)}
        >
          <p>เมื่อบันทึกแล้ว คุณจะ<b className="font-semibold text-ink">เอาติ๊กออกเองไม่ได้</b> และคนอื่นจะเลือกรายการเหล่านี้ไม่ได้</p>
          <p className="font-mono text-[13px] text-ink/70">
            {[...selected].slice(0, 6).map((k) => k.replace('|', ' · ')).join(', ')}
            {selected.size > 6 ? ` … และอีก ${selected.size - 6} รายการ` : ''}
          </p>
        </ConfirmDialog>
      )}
      {confirm === 'assign' && (
        <ConfirmDialog
          title={`ส่งคำขอให้ ${nameOf(recipientUser?.email)} ยืนยัน ${assignSel.size} รายการ?`}
          confirmLabel="ส่งคำขอ"
          busy={saving}
          onConfirm={doAssign}
          onCancel={() => setConfirm(null)}
        >
          <p>ผู้รับจะเห็นแจ้งเตือนที่หน้าหลักและต้องกดยืนยันก่อน จึงจะเป็นผู้ดูแลสิทธิเหล่านี้ (ระหว่างรอ รายการจะถูกจองไว้)</p>
          <p className="font-mono text-[13px] text-ink/70">
            {[...assignSel].slice(0, 6).map((k) => k.replace('|', ' · ')).join(', ')}
            {assignSel.size > 6 ? ` … และอีก ${assignSel.size - 6} รายการ` : ''}
          </p>
        </ConfirmDialog>
      )}
    </main>
  )
}
