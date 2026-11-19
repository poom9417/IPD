import { useMemo, useState } from 'react'

/**
 * แสดงไฟล์ REP ต้นฉบับแบบเดียวกับที่เคยเปิดดูใน Notepad (ตัวอักษรคงที่ ทุกบรรทัดตามไฟล์)
 * เพื่อให้ผู้ใช้ตรวจเทียบกับระบบได้เหมือนเดิม — ไฮไลต์บรรทัดที่ไม่ผ่าน (C) และค้นหา encounter_id / ชื่อได้
 */
export default function RepOriginalView({ text, title }: { text: string | null | undefined; title?: string }) {
  const [q, setQ] = useState('')
  const [wrap, setWrap] = useState(false)
  const lines = useMemo(() => (text ?? '').split(/\r?\n/), [text])
  const needle = q.trim()
  const hits = useMemo(() => (needle ? lines.filter((l) => l.includes(needle)).length : 0), [lines, needle])

  if (!text) {
    return (
      <div className="rounded-lg border border-line bg-brand-soft px-4 py-3 text-sm text-ink">
        REP ไฟล์นี้ยังไม่ได้เก็บข้อความต้นฉบับไว้ (บันทึกก่อนมีฟีเจอร์นี้) — อัปโหลดไฟล์ .REP เดิมอีกครั้งที่ขั้นที่ 1 แล้วกดบันทึก ระบบจะเก็บต้นฉบับให้
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-xl border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-3">
        {title && <div className="text-sm font-semibold text-ink">{title}</div>}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ค้นหา encounter_id / ชื่อ / รหัส"
          className="rounded-lg border border-ink/30 bg-surface px-3 py-1.5 text-sm text-ink"
        />
        {needle && <span className="text-xs text-ink/70">พบ {hits} บรรทัด</span>}
        <label className="flex items-center gap-1.5 text-xs text-ink/70">
          <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
          ตัดบรรทัดยาว
        </label>
        <span className="text-xs text-ink/50">{lines.length} บรรทัด · แถบสีแดง = รายการที่ไม่ผ่าน (C)</span>
      </div>
      <div className="max-h-[65vh] overflow-auto rounded-lg border border-line bg-paper py-1 font-mono text-[12px] leading-5 text-ink">
        {lines.map((l, i) => {
          const isC = /^\*\|\s*\S+\s+C\s+\d+/.test(l)
          const hit = needle !== '' && l.includes(needle)
          return (
            <div
              key={i}
              className={'flex ' + (hit ? 'bg-brand/50' : isC ? 'bg-rose-soft/60' : '')}
            >
              <span className="w-12 shrink-0 select-none pr-2 text-right text-ink/40">{i + 1}</span>
              <span className={wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'}>{l || ' '}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
