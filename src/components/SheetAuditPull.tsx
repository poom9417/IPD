import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fmtIsoDate, previewSheetAudit, type PullItem, type PullResult, type PullTarget } from '../lib/sheetSync'

interface Props {
  onClose: () => void
  /** เรียกหลังบันทึกวัน Audit สำเร็จ */
  onDone: () => void
}

type Tab = 'ok' | 'warn' | 'error' | 'ignored' | 'all'
type DupMode = 'skip' | 'overwrite'

const PAGE_SIZE = 100
const WRITE_CHUNK = 500

const TAB_LABEL: Record<Tab, string> = {
  ok: 'พร้อมนำเข้า',
  warn: 'มีข้อควรตรวจ',
  error: 'ผิดพลาด (ไม่นำเข้า)',
  ignored: 'ซ้ำในชีต (ตัดออก)',
  all: 'ทั้งหมด',
}

function inTab(i: PullItem, tab: Tab): boolean {
  if (tab === 'all') return true
  if (tab === 'ignored') return !!i.ignored
  if (i.ignored) return false
  return i.status === tab
}

/** แถวที่เลือกได้ = ไม่ผิดพลาด ไม่ถูกตัดเพราะซ้ำ และมีเคสเป้าหมายในระบบ */
const selectable = (i: PullItem) => !i.ignored && i.status !== 'error' && i.targets.length > 0

export default function SheetAuditPull({ onClose, onDone }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<PullResult | null>(null)
  const [tab, setTab] = useState<Tab>('ok')
  const [page, setPage] = useState(1)
  const [included, setIncluded] = useState<Set<number>>(new Set())
  const [dupMode, setDupMode] = useState<DupMode>('skip')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function load() {
    setLoading(true)
    setError(null)
    setResult(null)
    setSaved(false)
    previewSheetAudit()
      .then((res) => {
        setData(res)
        // ค่าเริ่มต้น: เลือกเฉพาะแถวที่ไม่มีข้อควรตรวจ — แถวที่มีคำเตือนต้องให้คนตัดสินใจเอง
        setIncluded(new Set(res.items.filter((i) => selectable(i) && i.status === 'ok').map((i) => i.row)))
        setTab(res.summary.ok > 0 ? 'ok' : res.summary.warn > 0 ? 'warn' : 'error')
        setPage(1)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const items = data?.items ?? []
  const shown = useMemo(() => items.filter((i) => inTab(i, tab)), [items, tab])
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const curPage = Math.min(page, pageCount)
  const pageRows = shown.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE)

  const tabCount = (t: Tab) => items.filter((i) => inTab(i, t)).length

  // แถวสิทธิ (target) ที่จะถูกเขียนจริง ตามแถวที่เลือก + โหมดจัดการค่าเดิม
  const writesOf = (i: PullItem): PullTarget[] =>
    i.targets.filter((t) => t.state === 'new' || (t.state === 'conflict' && dupMode === 'overwrite'))

  const stats = useMemo(() => {
    let n = 0
    let same = 0
    let conflict = 0
    for (const i of items) {
      if (!included.has(i.row) || !selectable(i)) continue
      for (const t of i.targets) {
        if (t.state === 'new') n++
        else if (t.state === 'same') same++
        else conflict++
      }
    }
    return { n, same, conflict }
  }, [items, included])

  const writeCount = stats.n + (dupMode === 'overwrite' ? stats.conflict : 0)

  function toggle(row: number) {
    setIncluded((prev) => {
      const next = new Set(prev)
      if (next.has(row)) next.delete(row)
      else next.add(row)
      return next
    })
  }

  // เลือก/ยกเลิกทั้งหมดของแท็บที่เปิดอยู่ (เฉพาะแถวที่เลือกได้)
  function toggleTab() {
    const rows = shown.filter(selectable).map((i) => i.row)
    const allOn = rows.length > 0 && rows.every((r) => included.has(r))
    setIncluded((prev) => {
      const next = new Set(prev)
      for (const r of rows) {
        if (allOn) next.delete(r)
        else next.add(r)
      }
      return next
    })
  }

  async function handleConfirm() {
    if (writeCount === 0 || saving) return
    setSaving(true)
    setResult(null)
    // key = admission_id (1 แถวชีตอาจลงได้หลายสิทธิ/ผู้จ่ายของ encounter เดียวกัน) — ส่งเฉพาะ audit_date ไม่แตะฟิลด์อื่น
    const payload = new Map<number, { admission_id: number; encounter_id: number; audit_date: string }>()
    for (const i of items) {
      if (!included.has(i.row) || !selectable(i) || i.encounter_id === null || !i.audit_date) continue
      for (const t of writesOf(i)) {
        payload.set(t.admission_id, { admission_id: t.admission_id, encounter_id: i.encounter_id, audit_date: i.audit_date })
      }
    }
    const rows = [...payload.values()]
    let done = 0
    try {
      for (let k = 0; k < rows.length; k += WRITE_CHUNK) {
        const chunk = rows.slice(k, k + WRITE_CHUNK)
        const { error: e } = await supabase.from('case_tracking').upsert(chunk, { onConflict: 'admission_id' })
        if (e) throw e
        done += chunk.length
      }
      // บันทึกเวลาดึงล่าสุด (ถ้ายังไม่ได้สร้างฟังก์ชันนี้ใน DB ก็ไม่ถือเป็นความผิดพลาด)
      await supabase.rpc('mark_sheet_pull', { p_rows: done })
      const skipped = dupMode === 'skip' ? stats.conflict : 0
      setResult(
        `บันทึกวัน Audit สำเร็จ ${done.toLocaleString()} รายการ (แถวสิทธิ)` +
          (skipped > 0 ? ` · ข้ามเคสที่มีวัน Audit เดิม ${skipped}` : '') +
          (stats.same > 0 ? ` · เหมือนเดิม ไม่ต้องบันทึก ${stats.same}` : ''),
      )
      setSaved(true)
      onDone()
    } catch (e) {
      const msg = e instanceof Error ? e.message : (e as { message?: string })?.message
      setResult(
        `บันทึกไม่สำเร็จ: ${msg ?? e}` + (done > 0 ? ` (บันทึกไปแล้ว ${done.toLocaleString()} รายการก่อนหน้านี้ — โหลดใหม่เพื่อดูสถานะล่าสุด)` : ''),
      )
    } finally {
      setSaving(false)
    }
  }

  const tabRows = shown.filter(selectable)
  const allTabOn = tabRows.length > 0 && tabRows.every((i) => included.has(i.row))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-y-auto rounded-2xl bg-surface p-6 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">ดึงวัน Audit จาก Google Sheet</h2>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-lg leading-none text-ink hover:bg-brand">
            ✕
          </button>
        </div>

        {loading && <p className="py-10 text-center text-sm text-ink/60">กำลังอ่านชีตและตรวจข้อมูล… (อาจใช้เวลาสักครู่)</p>}

        {!loading && error && (
          <div className="mb-3 rounded-lg border border-rose/30 bg-rose-soft/50 px-4 py-3 text-sm text-rose">
            <p className="mb-2">{error}</p>
            <button onClick={load} className="rounded-lg border border-rose/40 px-3 py-1 text-sm hover:bg-rose-soft">
              ลองใหม่
            </button>
          </div>
        )}

        {!loading && data && (
          <>
            <p className="mb-2 text-sm text-ink/70">
              อ่านจากแท็บ AUDIT_VIEW {data.summary.total.toLocaleString()} แถว · พร้อมนำเข้า {data.summary.ok.toLocaleString()} · มีข้อควรตรวจ{' '}
              {data.summary.warn.toLocaleString()} · ผิดพลาด {data.summary.error.toLocaleString()}
              {data.summary.ignored > 0 && <> · ซ้ำในชีต {data.summary.ignored.toLocaleString()}</>}
            </p>
            <p className="mb-3 text-xs text-ink/50">
              แถวที่พร้อมนำเข้าถูกเลือกไว้ให้แล้ว ส่วนแถวที่มีข้อควรตรวจ (เช่น สิทธิ/HN/ชื่อไม่ตรง) ไม่ถูกเลือก ต้องติ๊กเองหลังตรวจดู — การจับคู่ใช้ encounter_id + สิทธิ
            </p>

            <div className="mb-3 flex flex-wrap items-center gap-2">
              {(['ok', 'warn', 'error', 'ignored', 'all'] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setTab(t)
                    setPage(1)
                  }}
                  className={
                    'rounded-lg border px-3 py-1.5 text-sm transition-colors ' +
                    (tab === t ? 'border-ink bg-brand font-semibold text-ink' : 'border-ink/30 text-ink hover:bg-brand-soft')
                  }
                >
                  {TAB_LABEL[t]} ({tabCount(t).toLocaleString()})
                </button>
              ))}
              {tabRows.length > 0 && (
                <button onClick={toggleTab} className="ml-auto rounded-lg border border-ink/30 px-3 py-1.5 text-sm text-ink hover:bg-brand-soft">
                  {allTabOn ? 'ยกเลิกเลือกทั้งแท็บนี้' : `เลือกทั้งแท็บนี้ (${tabRows.length.toLocaleString()})`}
                </button>
              )}
            </div>

            <div className="mb-3 max-h-[46vh] overflow-auto rounded-lg border border-line text-xs">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-paper text-ink/50">
                  <tr>
                    <th className="px-2 py-1.5"></th>
                    <th className="px-2 py-1.5">แถวชีต</th>
                    <th className="px-2 py-1.5">encounter_id</th>
                    <th className="px-2 py-1.5">HN</th>
                    <th className="px-2 py-1.5">ชื่อ</th>
                    <th className="px-2 py-1.5">สิทธิ</th>
                    <th className="px-2 py-1.5">วัน Audit</th>
                    <th className="px-2 py-1.5">ในระบบ</th>
                    <th className="px-2 py-1.5">ผลตรวจ</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-2 py-6 text-center text-ink/50">
                        ไม่มีรายการในแท็บนี้
                      </td>
                    </tr>
                  )}
                  {pageRows.map((i) => {
                    const can = selectable(i)
                    return (
                      <tr key={i.row} className={`border-t border-line align-top ${i.ignored ? 'opacity-60' : ''}`}>
                        <td className="px-2 py-1.5">
                          {can && <input type="checkbox" checked={included.has(i.row)} onChange={() => toggle(i.row)} />}
                        </td>
                        <td className="px-2 py-1.5 text-ink/60">{i.row}</td>
                        <td className="px-2 py-1.5">{i.encounter_id ?? '—'}</td>
                        <td className="px-2 py-1.5">{i.hn || '—'}</td>
                        <td className="px-2 py-1.5">{i.name || '—'}</td>
                        <td className="px-2 py-1.5">{i.sithi || '—'}</td>
                        <td className="px-2 py-1.5">{fmtIsoDate(i.audit_date)}</td>
                        <td className="px-2 py-1.5">
                          {i.targets.length === 0
                            ? '—'
                            : i.targets.map((t) => (
                                <span key={t.admission_id} className="block">
                                  {i.targets.length > 1 && <span className="text-ink/50">{t.coverage_code}/{t.payer_id}: </span>}
                                  {t.state === 'new' ? (
                                    <span>ยังไม่มีวัน Audit</span>
                                  ) : t.state === 'same' ? (
                                    <span className="text-ink/50">เหมือนเดิม</span>
                                  ) : (
                                    <span className="font-semibold text-alert">
                                      {dupMode === 'skip' ? 'มีเดิม — จะข้าม' : 'มีเดิม — จะเขียนทับ'} ({fmtIsoDate(t.existing)})
                                    </span>
                                  )}
                                </span>
                              ))}
                        </td>
                        <td className="px-2 py-1.5">
                          {i.ignored ? (
                            <span className="text-ink/60">{i.ignored}</span>
                          ) : i.status === 'error' ? (
                            <span className="text-rose">{i.messages.join(' · ')}</span>
                          ) : i.status === 'warn' ? (
                            <span className="text-alert">{i.messages.join(' · ')}</span>
                          ) : (
                            <span className="font-semibold text-ink">ผ่าน</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {shown.length > PAGE_SIZE && (
              <div className="mb-3 flex items-center justify-between text-sm text-ink/60">
                <span>
                  หน้า {curPage} / {pageCount}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(curPage - 1)}
                    disabled={curPage <= 1}
                    className="rounded-lg border border-line px-3 py-1 hover:bg-paper disabled:opacity-40"
                  >
                    ก่อนหน้า
                  </button>
                  <button
                    onClick={() => setPage(curPage + 1)}
                    disabled={curPage >= pageCount}
                    className="rounded-lg border border-line px-3 py-1 hover:bg-paper disabled:opacity-40"
                  >
                    ถัดไป
                  </button>
                </div>
              </div>
            )}

            <p className="mb-3 text-sm text-ink/70">
              ที่เลือกไว้: ใหม่ {stats.n.toLocaleString()} · มีวัน Audit เดิมและต่างจากชีต {stats.conflict.toLocaleString()} · เหมือนเดิม{' '}
              {stats.same.toLocaleString()} (นับเป็นแถวสิทธิ)
            </p>

            {stats.conflict > 0 && (
              <div className="mb-3 rounded-lg border border-alert bg-paper px-3 py-2.5 text-sm text-ink">
                <p className="mb-1.5 font-semibold">พบ {stats.conflict} เคสที่มีวัน Audit ในระบบอยู่แล้วและต่างจากชีต — ต้องการทำอย่างไร</p>
                <label className="mb-1 flex cursor-pointer items-start gap-2">
                  <input type="radio" name="pullDup" checked={dupMode === 'skip'} onChange={() => setDupMode('skip')} className="mt-1" />
                  <span>ข้ามเคสที่มีข้อมูลเดิม (เก็บค่าเดิมไว้ บันทึกเฉพาะเคสใหม่)</span>
                </label>
                <label className="flex cursor-pointer items-start gap-2">
                  <input type="radio" name="pullDup" checked={dupMode === 'overwrite'} onChange={() => setDupMode('overwrite')} className="mt-1" />
                  <span>เขียนทับด้วยวันจากชีต (ค่าเดิมจะหายไป)</span>
                </label>
              </div>
            )}
          </>
        )}

        {result && <p className="mb-3 text-sm text-ink">{result}</p>}

        <div className="flex justify-end gap-2">
          {data && !loading && (
            <button onClick={load} disabled={saving} className="rounded-lg border border-ink/30 px-4 py-2 text-sm text-ink hover:bg-brand-soft disabled:opacity-40">
              อ่านชีตใหม่
            </button>
          )}
          <button onClick={onClose} className="rounded-lg border border-ink/40 px-4 py-2 text-sm font-medium text-ink hover:bg-brand-soft">
            ปิด
          </button>
          <button
            onClick={handleConfirm}
            disabled={writeCount === 0 || saving || loading || saved || !!error}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-ink hover:bg-brand-dark disabled:opacity-50"
          >
            {saving ? 'กำลังบันทึก…' : saved ? 'บันทึกแล้ว' : `บันทึก ${writeCount.toLocaleString()} เคส`}
          </button>
        </div>
      </div>
    </div>
  )
}
