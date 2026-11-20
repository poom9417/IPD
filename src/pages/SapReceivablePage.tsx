import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Button from '../components/ui/Button'
import { decodeRep, parseRep, splitMsg, type RepFile } from '../lib/cignRep'
import RepOriginalView from '../components/RepOriginalView'
import {
  DUP_LABEL,
  MATCH_LABEL,
  checkDuplicates,
  findSavedFile,
  loadRawText,
  listSavedFiles,
  loadSavedItems,
  markSapGenerated,
  matchEncounters,
  saveRep,
  updateMatches,
  type DupInfo,
  type MatchResult,
  type SavedFile,
  type SavedItem,
} from '../lib/repStore'
import { SAP_PAYERS, buildSapText, computeAmounts, type SapCase } from '../lib/sapReceivable'

const money = (n: number | null | undefined) =>
  n == null ? '–' : n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')
const th = 'whitespace-nowrap px-2 py-2 text-xs font-semibold'
const td = 'whitespace-nowrap px-2 py-2'

type Tab = 'save' | 'sap'

export default function SapReceivablePage() {
  const [tab, setTab] = useState<Tab>('save')
  // เพิ่มค่าทุกครั้งที่บันทึก REP ใหม่ เพื่อให้แท็บที่ 2 โหลดรายการไฟล์ใหม่
  const [savedNonce, setSavedNonce] = useState(0)

  const tabCls = (t: Tab) =>
    'rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ' +
    (tab === t ? 'border-ink bg-brand text-ink' : 'border-ink/30 text-ink hover:bg-brand-soft')

  return (
    <main className="w-full space-y-4 px-4 py-6 sm:px-8">
      <div>
        <h1 className="text-xl font-bold text-ink">ตั้งหนี้ SAP จากไฟล์ตอบกลับ (REP)</h1>
        <p className="mt-1 text-sm text-ink/70">
          ขั้นที่ 1 บันทึกผลตอบกลับ REP ลงระบบ (ผ่าน/ไม่ผ่าน ยอด DRG จับคู่เคสและเลขตั้งเบิก) → ขั้นที่ 2 สร้างไฟล์ txt สำหรับนำเข้า SAP จากข้อมูลที่บันทึกไว้
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={tabCls('save')} onClick={() => setTab('save')}>
          1 · บันทึกผลตอบกลับ REP
        </button>
        <button type="button" className={tabCls('sap')} onClick={() => setTab('sap')}>
          2 · สร้างไฟล์สำหรับ SAP
        </button>
      </div>
      <div className={tab === 'save' ? '' : 'hidden'}>
        <SaveTab onSaved={() => setSavedNonce((n) => n + 1)} />
      </div>
      <div className={tab === 'sap' ? '' : 'hidden'}>
        <SapTab nonce={savedNonce} active={tab === 'sap'} />
      </div>
    </main>
  )
}

/* ───────────── ขั้นที่ 1: อ่าน REP → จับคู่ → บันทึก ───────────── */

function SaveTab({ onSaved }: { onSaved: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [rep, setRep] = useState<RepFile | null>(null)
  const [fileName, setFileName] = useState('')
  const [matches, setMatches] = useState<Map<number, MatchResult>>(new Map())
  const [existing, setExisting] = useState<{ file: SavedFile; generated: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [dups, setDups] = useState<Map<number, DupInfo>>(new Map())
  // encounter_id ที่เลือกข้าม (ไม่บันทึก) — เคสซ้ำผิดปกติถูกตั้งเป็น "ข้าม" ไว้ก่อน ผู้ใช้เปลี่ยนเป็น "บันทึก" ได้
  const [skip, setSkip] = useState<Set<number>>(new Set())
  const [showRaw, setShowRaw] = useState(false)

  async function onFile(f: File) {
    setError(null)
    setDone(null)
    setRep(null)
    setExisting(null)
    setDups(new Map())
    setSkip(new Set())
    setShowRaw(false)
    setLoading(true)
    try {
      const parsed = parseRep(decodeRep(await f.arrayBuffer()))
      setRep(parsed)
      setFileName(f.name)
      const inputs = [
        ...parsed.items.map((i) => ({ encounterId: i.encounterId, section: i.section })),
        ...parsed.notPassed.map((n) => ({ encounterId: n.encounterId, section: 0 })),
      ]
      const mm = await matchEncounters(inputs)
      setMatches(mm)
      const dd = await checkDuplicates(parsed, mm)
      setDups(dd)
      setSkip(new Set([...dd].filter(([, d]) => d.needsDecision).map(([enc]) => enc)))
      setExisting(await findSavedFile(parsed.hospCode, parsed.repNo))
    } catch (e) {
      setError(e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e))
    } finally {
      setLoading(false)
    }
  }

  const rows = useMemo(() => {
    if (!rep) return []
    return [
      ...rep.items.map((i) => ({ key: 'A' + i.encounterId, enc: i.encounterId, tcode: 'A', name: i.name, item: i, msg: i.msgRaw })),
      ...rep.notPassed.map((n) => ({ key: 'N' + n.encounterId, enc: n.encounterId, tcode: n.tcode, name: n.name, item: null, msg: n.msgRaw })),
    ]
  }, [rep])

  const problems = rows.filter((r) => (matches.get(r.enc)?.status ?? 'no_admission') !== 'matched')
  const noClaim = rows.filter((r) => r.tcode === 'A' && matches.get(r.enc)?.status === 'matched' && !matches.get(r.enc)?.claimNo)
  const repSum = rep ? rep.items.reduce((s, i) => s + Math.round(i.paid * 100), 0) / 100 : 0
  const diffHead = !!rep && rep.headerTotal != null && Math.abs(repSum - rep.headerTotal) > 0.005
  const dupList = [...dups.entries()]
  const dupAbnormal = dupList.filter(([, d]) => d.needsDecision)
  const dupResent = dupList.filter(([, d]) => !d.needsDecision)
  const cRows = rows.filter((r) => r.tcode !== 'A')
  const cCodeCount = cRows.reduce((n, r) => n + splitMsg(r.msg).codes.filter((c) => c.kind === 'error').length, 0)

  async function save() {
    if (!rep) return
    setSaving(true)
    setError(null)
    try {
      const r = await saveRep(rep, fileName, matches, { skip, dups })
      setDone(
        `บันทึก REP เลขที่ ${rep.repNo} แล้ว ${r.saved} รายการ (ผ่าน ${rep.items.length} · ไม่ผ่าน ${rep.notPassed.length})` +
          ` · แยกรหัสที่ต้องแก้ ${r.codes} รหัส` +
          (r.skipped > 0 ? ` · ข้าม ${r.skipped} รายการที่เลือกข้าม` : '') +
          (r.newMasterCodes > 0 ? ` · เพิ่มรหัสใหม่เข้า master C ${r.newMasterCodes} รหัส` : ''),
      )
      setExisting(await findSavedFile(rep.hospCode, rep.repNo))
      setSkip(new Set())
      onSaved()
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? String(e)
      setError(
        /rep_files|rep_items|relation|schema cache/i.test(msg)
          ? `บันทึกไม่สำเร็จ: ยังไม่มีตาราง rep_files / rep_items ในฐานข้อมูล (ต้องรัน supabase/20261113_rep_reply_tables.sql ก่อน) — ${msg}`
          : `บันทึกไม่สำเร็จ: ${msg}`,
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-4">
        <input
          ref={fileRef}
          type="file"
          accept=".rep,.REP,.txt"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onFile(f)
            e.target.value = ''
          }}
        />
        <Button type="button" onClick={() => fileRef.current?.click()} disabled={loading}>
          {loading ? 'กำลังอ่านและจับคู่…' : 'เลือกไฟล์ REP'}
        </Button>
        {rep && (
          <span className="text-sm text-ink/70">
            {fileName} · รพ. {rep.hospCode} · เอกสารตอบรับเลขที่ {rep.repNo} · วันที่ตอบกลับ {fmtDate(rep.issueDate)}
          </span>
        )}
      </div>

      {error && <Notice>{error}</Notice>}

      {rep && !loading && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Card label="ผ่าน (A)" value={`${rep.items.length} ราย`} sub={`หัวไฟล์ระบุ ${rep.headerCount ?? '–'} ราย`} />
            <Card label="ไม่ผ่าน / ต้องแก้ไข" value={`${rep.notPassed.length} ราย`} sub={`รหัสที่ต้องแก้ ${cCodeCount} รหัส (ก่อน 837)`} />
            <Card label="จับคู่เคสไม่ได้" value={`${problems.length} ราย`} sub="ต้องเจอทุกเคสที่ส่งเบิกแล้ว" warn={problems.length > 0} />
            <Card
              label="รวมยอดตามรายการ (A)"
              value={money(repSum)}
              sub={`ยอดรวมหัวไฟล์ ${money(rep.headerTotal)}`}
              warn={diffHead}
            />
          </div>

          {problems.length > 0 && (
            <Notice>
              <b>จับคู่เคสไม่ได้ {problems.length} ราย</b> ซึ่งไม่ควรเกิดขึ้น เพราะทุกเคสใน REP ต้องเป็นเคสที่ส่งเบิกแล้ว ตรวจรายการสีแดงในตาราง ถ้าบันทึกตอนนี้ รายการเหล่านี้จะถูกเก็บไว้พร้อมสถานะที่จับคู่ไม่ได้ (ไม่ถูกตัดทิ้ง):{' '}
              {problems.map((p) => p.enc).join(', ')}
            </Notice>
          )}
          {noClaim.length > 0 && (
            <Notice>
              พบเคสในระบบแต่ยังไม่มีเลขตั้งเบิก (claim_no) {noClaim.length} ราย: {noClaim.map((p) => p.enc).join(', ')}
            </Notice>
          )}
          {diffHead && (
            <Notice>
              ยอดรวมรายการ ({money(repSum)}) ไม่เท่ากับยอดรวมที่หัวไฟล์ ({money(rep.headerTotal)}) ต่างกัน {money((rep.headerTotal ?? 0) - repSum)} บาท
            </Notice>
          )}
          {rep.unreadable.length > 0 && (
            <Notice>
              มี {rep.unreadable.length} บรรทัดที่อ่านรูปแบบไม่ได้ (เช่น FFS/PD) จึงไม่ถูกบันทึก ต้องตรวจเอง
            </Notice>
          )}
          {dupAbnormal.length > 0 && (
            <Notice>
              <b>เลขซ้ำผิดปกติ {dupAbnormal.length} ราย</b> — REP คือรายการที่ส่งเบิกไปจริง จึงซ้ำได้เฉพาะเคสที่ติด C แล้วส่งใหม่ด้วยเลขตั้งเบิกใหม่ ระบบตั้งเป็น "ข้าม" ไว้ให้ก่อน เลือก "บันทึก (ติดป้ายซ้ำ)" ในคอลัมน์ท้ายตารางได้ถ้าต้องการเก็บ:{' '}
              {dupAbnormal.map(([enc, d]) => `${enc} (${DUP_LABEL[d.flag]})`).join(', ')}
            </Notice>
          )}
          {dupResent.length > 0 && (
            <div className="rounded-lg border border-line bg-brand-soft px-4 py-2 text-sm text-ink">
              ส่งใหม่หลังติด C ด้วยเลขตั้งเบิกใหม่ {dupResent.length} ราย (ปกติ ผ่านหรือไม่ผ่านดูได้ที่หน้า Code C): {dupResent.map(([enc]) => enc).join(', ')}
            </div>
          )}
          {existing && (
            <div className="rounded-lg border border-line bg-brand-soft px-4 py-2 text-sm text-ink">
              REP เลขที่ {existing.file.rep_no} เคยบันทึกไว้เมื่อ {fmtDate(existing.file.uploaded_at)} แล้ว บันทึกซ้ำจะอัปเดตข้อมูลและผลจับคู่
              {existing.generated > 0 ? ` (สถานะที่สร้างไฟล์ SAP แล้ว ${existing.generated} ราย จะไม่ถูกแตะ)` : ''}
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[1900px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="bg-brand text-ink">
                  <th className={th}>ผล REP</th>
                  <th className={th}>จับคู่เคส</th>
                  <th className={th}>encounter_id</th>
                  <th className={th}>ชื่อผู้ป่วย</th>
                  <th className={th}>DRG</th>
                  <th className={th + ' text-right'}>RW</th>
                  <th className={th + ' text-right'}>AdjRW</th>
                  <th className={th + ' text-right'}>CCUF</th>
                  <th className={th + ' text-right'}>เงิน DRG</th>
                  <th className={th + ' text-right'}>นอก DRG</th>
                  <th className={th + ' text-right'}>รวมรายบุคคล</th>
                  <th className={th}>pcode</th>
                  <th className={th}>สิทธิ / ผู้จ่าย</th>
                  <th className={th}>เลขตั้งเบิก</th>
                  <th className={th}>รหัสที่ต้องแก้ (ก่อน 837)</th>
                  <th className={th}>ซ้ำ / ส่งใหม่</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const m = matches.get(r.enc)
                  const bad = !m || m.status !== 'matched'
                  const i = r.item
                  return (
                    <tr key={r.key} className={'border-b border-line ' + (bad ? 'bg-rose-soft/50' : 'hover:bg-paper')}>
                      <td className={td}>{r.tcode === 'A' ? 'ผ่าน (A)' : `ไม่ผ่าน (${r.tcode})`}</td>
                      <td className={td + (bad ? ' whitespace-normal text-rose' : '')}>
                        {bad ? `${MATCH_LABEL[m?.status ?? 'no_admission']}${m?.note ? ` — ${m.note}` : ''}` : MATCH_LABEL.matched}
                      </td>
                      <td className={td + ' tabular-nums'}>{r.enc}</td>
                      <td className={td}>{r.name}</td>
                      <td className={td}>{i?.drgCode ?? '–'}</td>
                      <td className={td + ' text-right tabular-nums'}>{i ? i.rw.toFixed(4) : '–'}</td>
                      <td className={td + ' text-right tabular-nums'}>{i ? i.adjRw.toFixed(4) : '–'}</td>
                      <td className={td + ' text-right tabular-nums'}>{i?.ccuf != null ? i.ccuf.toFixed(4) : '–'}</td>
                      <td className={td + ' text-right tabular-nums'}>{i ? money(i.drgAmount) : '–'}</td>
                      <td className={td + ' text-right tabular-nums'}>{i ? money(i.outDrgAmount) : '–'}</td>
                      <td className={td + ' text-right font-semibold tabular-nums'}>{i ? money(i.paid) : '–'}</td>
                      <td className={td}>{i?.pcode ?? '–'}</td>
                      <td className={td}>{m?.coverageCode ? `${m.coverageCode} / ${m.payerId}` : '–'}</td>
                      <td className={td + (m?.status === 'matched' && !m.claimNo ? ' text-rose' : '')}>{m?.claimNo ?? (m?.status === 'matched' ? 'ไม่มี' : '–')}</td>
                      <td className={td + ' whitespace-normal'}>
                        <CodeChips msg={r.msg} />
                      </td>
                      <td className={td + ' whitespace-normal'}>
                        <DupCell info={dups.get(r.enc)} skipped={skip.has(r.enc)} onChange={(sk) => setSkip((cur) => { const n = new Set(cur); if (sk) n.add(r.enc); else n.delete(r.enc); return n })} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-4">
            <Button type="button" onClick={() => void save()} disabled={saving}>
              {saving ? 'กำลังบันทึก…' : `บันทึกผลตอบกลับลงระบบ (${rows.length - skip.size} รายการ)`}
            </Button>
            <Button type="button" variant="outline" onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? 'ซ่อนต้นฉบับ REP' : 'ดูต้นฉบับ REP (แบบ Notepad)'}
            </Button>
            <span className="text-sm text-ink/70">บันทึกแล้วดูเคสติด C ที่หน้า Code C · ไปขั้นที่ 2 เพื่อสร้างไฟล์ SAP</span>
          </div>
          {showRaw && <RepOriginalView text={rep.rawText} title={`REP ${rep.repNo} · ${fileName}`} />}
          {done && <div className="rounded-lg border border-line bg-brand-soft px-4 py-2 text-sm text-ink">{done}</div>}
        </>
      )}
    </div>
  )
}

/* ───────────── ขั้นที่ 2: จาก REP ที่บันทึกไว้ → ไฟล์ SAP ───────────── */

interface SapRow {
  item: SavedItem
  live: MatchResult | undefined
  /** null = พร้อมสร้าง */
  problem: string | null
  already: boolean
  sap: SapCase | null
  /** true = ไม่มียอดตั้งเบิก ต้องกลับไปใส่ที่หน้าหลักก่อนจึงสร้างไฟล์ได้ */
  missingAmount?: boolean
}

function SapTab({ nonce, active }: { nonce: number; active: boolean }) {
  const [files, setFiles] = useState<SavedFile[]>([])
  const [fileId, setFileId] = useState<number | null>(null)
  const [items, setItems] = useState<SavedItem[]>([])
  const [live, setLive] = useState<Map<number, MatchResult>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ack, setAck] = useState(false)
  const [includeAlready, setIncludeAlready] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [raw, setRaw] = useState<{ fileId: number; text: string | null } | null>(null)

  async function toggleRaw() {
    if (raw && raw.fileId === fileId) return setRaw(null)
    if (fileId == null) return
    try {
      setRaw({ fileId, text: await loadRawText(fileId) })
    } catch (e) {
      setError(`โหลดต้นฉบับ REP ไม่สำเร็จ: ${(e as { message?: string })?.message ?? String(e)}`)
    }
  }

  useEffect(() => {
    if (!active) return
    let cancelled = false
    listSavedFiles()
      .then((f) => {
        if (cancelled) return
        setFiles(f)
        setError(null)
        setFileId((cur) => cur ?? f[0]?.id ?? null)
      })
      .catch((e) => {
        if (!cancelled) setError(`โหลดรายการ REP ที่บันทึกไว้ไม่สำเร็จ: ${(e as { message?: string })?.message ?? String(e)}`)
      })
    return () => {
      cancelled = true
    }
  }, [active, nonce])

  async function load(id: number) {
    setLoading(true)
    setError(null)
    setDone(null)
    setAck(false)
    setIncludeAlready(false)
    try {
      const its = await loadSavedItems(id)
      setItems(its)
      setLive(await matchEncounters(its.filter((i) => i.tcode === 'A').map((i) => ({ encounterId: i.encounter_id, section: i.section ?? 1 }))))
    } catch (e) {
      setError(`โหลดข้อมูลไม่สำเร็จ: ${(e as { message?: string })?.message ?? String(e)}`)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    setRaw(null)
    if (fileId != null) void load(fileId)
  }, [fileId])

  const file = files.find((f) => f.id === fileId) ?? null
  const aItems = items.filter((i) => i.tcode === 'A')
  const notPassed = items.filter((i) => i.tcode !== 'A')

  const rows: SapRow[] = useMemo(() => {
    if (!file) return []
    return aItems.map((item) => {
      const m = live.get(item.encounter_id)
      const base = { item, live: m, already: !!item.sap_generated_at, sap: null }
      if (!m || m.status !== 'matched') return { ...base, problem: `จับคู่เคสไม่ได้: ${MATCH_LABEL[m?.status ?? 'no_admission']}${m?.note ? ` (${m.note})` : ''}` }
      if (!m.payerId || !SAP_PAYERS[m.payerId]) return { ...base, problem: `ยังไม่รองรับไฟล์ SAP ของผู้จ่าย ${m.payerId ?? '–'} (ทำเพิ่มภายหลัง)` }
      if (item.pcode && item.pcode !== '0') return { ...base, problem: `ส่งเกินกำหนด (pcode ${item.pcode}) ยอดอาจถูกปรับ ให้ตรวจก่อน` }
      if (!m.hn) return { ...base, problem: 'ไม่มี HN' }
      if (!m.dischargeDate) return { ...base, problem: 'ไม่มีวันที่จำหน่าย' }
      if (!m.claimNo) return { ...base, problem: 'ไม่มีเลข Ref (claim_no)' }
      if (m.claimAmount == null || m.claimAmount <= 0) return { ...base, problem: 'ยังไม่มียอดตั้งเบิก — กลับไปใส่ยอดส่งเบิกที่หน้าหลักก่อน', missingAmount: true }
      if (item.total_amount == null) return { ...base, problem: 'ไม่มียอดที่จ่ายใน REP' }
      return {
        ...base,
        problem: null,
        sap: { encounterId: item.encounter_id, hn: m.hn, dischargeDate: m.dischargeDate, claimNo: m.claimNo, claimAmount: m.claimAmount, paid: item.total_amount, replyDate: file.issue_date },
      }
    }).sort((a, b) => Number(!!b.problem) - Number(!!a.problem))
  }, [aItems, live, file])

  const ready = rows.filter((r) => !r.problem && (!r.already || includeAlready))
  const withProblem = rows.filter((r) => r.problem || (r.already && !includeAlready))
  const changed = aItems.filter((i) => {
    const m = live.get(i.encounter_id)
    return m && (m.status !== i.match_status || m.admissionId !== i.admission_id || m.claimNo !== i.claim_no)
  })

  const totals = useMemo(() => {
    let a09 = 0, a40 = 0, a11 = 0, paid = 0
    for (const r of ready) {
      const a = computeAmounts(r.sap!.claimAmount, r.sap!.paid)
      a09 += Math.round(a.a09 * 100)
      a40 += Math.round(a.a40 * 100)
      a11 += Math.round(a.a11 * 100)
      paid += Math.round(r.sap!.paid * 100)
    }
    return { a09: a09 / 100, a40: a40 / 100, a11: a11 / 100, paid: paid / 100 }
  }, [ready])
  const missing = rows.filter((r) => r.missingAmount)
  const needAck = withProblem.length > 0 || notPassed.length > 0

  async function refreshMatches() {
    try {
      await updateMatches(changed.map((i) => ({ id: i.id, match: live.get(i.encounter_id)! })))
      if (fileId != null) await load(fileId)
      setDone('อัปเดตผลจับคู่ที่บันทึกไว้แล้ว')
    } catch (e) {
      setError(`อัปเดตไม่สำเร็จ: ${(e as { message?: string })?.message ?? String(e)}`)
    }
  }

  async function download() {
    if (!file || ready.length === 0) return
    const byPayer = new Map<string, SapRow[]>()
    for (const r of ready) byPayer.set(r.live!.payerId!, [...(byPayer.get(r.live!.payerId!) ?? []), r])
    let text = ''
    let tag = ''
    for (const [payer, rs] of byPayer) {
      const cfg = SAP_PAYERS[payer]
      tag ||= cfg.tagB
      text += buildSapText(rs.map((r) => r.sap!), cfg)
    }
    const name = `SAP_${tag}_REP${file.rep_no}_${file.issue_date.replace(/-/g, '')}.txt`
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    let msg = `สร้างไฟล์ ${name} แล้ว ${ready.length} เคส`
    try {
      await markSapGenerated(ready.map((r) => r.item.id), name)
      msg += ' และบันทึกสถานะ "สร้างไฟล์ SAP แล้ว" ไว้ในระบบ'
      if (fileId != null) await load(fileId)
    } catch (e) {
      msg += ` — แต่บันทึกสถานะไม่สำเร็จ: ${(e as { message?: string })?.message ?? String(e)}`
    }
    setDone(msg)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-4">
        <label className="text-sm text-ink/70">
          <div className="mb-1">เลือก REP ที่บันทึกไว้</div>
          <select
            value={fileId ?? ''}
            onChange={(e) => setFileId(Number(e.target.value))}
            className="rounded-lg border border-ink/30 bg-surface px-3 py-2 text-sm text-ink"
          >
            {files.length === 0 && <option value="">ยังไม่มี REP ที่บันทึกไว้</option>}
            {files.map((f) => (
              <option key={f.id} value={f.id}>
                REP {f.rep_no} · {fmtDate(f.issue_date)} · ผ่าน {f.passed_count} / ไม่ผ่าน {f.not_passed_count}
              </option>
            ))}
          </select>
        </label>
        {file && (
          <Button type="button" variant="outline" onClick={() => void toggleRaw()}>
            {raw && raw.fileId === fileId ? 'ซ่อนต้นฉบับ REP' : 'ดูต้นฉบับ REP (แบบ Notepad)'}
          </Button>
        )}
      </div>
      {raw && raw.fileId === fileId && <RepOriginalView text={raw.text} title={file ? `REP ${file.rep_no}` : undefined} />}

      {error && <Notice>{error}</Notice>}
      {loading && <div className="text-sm text-ink/70">กำลังโหลดและจับคู่ข้อมูลล่าสุด…</div>}

      {file && !loading && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card label="รายการผ่าน (A)" value={`${aItems.length} ราย`} sub={`REP ${file.rep_no} · ${fmtDate(file.issue_date)}`} />
            <Card label="พร้อมสร้างไฟล์" value={`${ready.length} ราย`} sub={`ยอดที่จ่าย ${money(totals.paid)}`} />
            <Card label="ยังสร้างไม่ได้ / ถูกข้าม" value={`${withProblem.length} ราย`} sub="เหตุผลอยู่ในตารางสีแดง" warn={withProblem.length > 0} />
            <Card label="สร้างไฟล์ SAP แล้ว" value={`${aItems.filter((i) => i.sap_generated_at).length} ราย`} sub="จากรายการผ่านของ REP นี้" />
          </div>

          {withProblem.length > 0 && (
            <Notice>
              <b>มี {withProblem.length} รายการที่สร้างไฟล์ไม่ได้</b> (ไม่ถูกข้ามเงียบ ๆ ต้องตรวจก่อน): {withProblem.map((r) => r.item.encounter_id).join(', ')}
            </Notice>
          )}
          {notPassed.length > 0 && (
            <Notice>
              REP นี้มี {notPassed.length} รายการที่ไม่ผ่าน (ต้องแก้ไขแล้วส่งใหม่) จึงไม่นำมาตั้งหนี้: {notPassed.map((n) => `${n.encounter_id} (${n.tcode})`).join(', ')}
            </Notice>
          )}
          {changed.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-brand-soft px-4 py-2 text-sm text-ink">
              ผลจับคู่ล่าสุด (เลขตั้งเบิก/สถานะเคส) ต่างจากที่บันทึกไว้ {changed.length} รายการ
              <Button type="button" variant="outline" onClick={() => void refreshMatches()}>
                อัปเดตผลจับคู่ที่บันทึกไว้
              </Button>
            </div>
          )}
          {rows.some((r) => r.already && !r.problem) && (
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={includeAlready} onChange={(e) => setIncludeAlready(e.target.checked)} />
              รวมรายการที่เคยสร้างไฟล์ SAP แล้ว ({rows.filter((r) => r.already && !r.problem).length} ราย) ปกติจะข้ามเพื่อกันตั้งซ้ำ
            </label>
          )}

          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[1100px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="bg-brand text-ink">
                  <th className={th}>สถานะ</th>
                  <th className={th}>encounter_id</th>
                  <th className={th}>HN</th>
                  <th className={th}>ชื่อผู้ป่วย</th>
                  <th className={th}>เลขตั้งเบิก</th>
                  <th className={th + ' text-right'}>ยอดที่จ่าย (REP)</th>
                  <th className={th + ' text-right'}>ยอดตั้งเบิก</th>
                  <th className={th + ' text-right'}>ส่วนต่าง (40)</th>
                  <th className={th}>บรรทัดที่สร้าง</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const s = r.sap
                  const amt = s ? computeAmounts(s.claimAmount, s.paid) : null
                  const skipped = !!r.problem || (r.already && !includeAlready)
                  return (
                    <tr key={r.item.id} className={'border-b border-line ' + (skipped ? 'bg-rose-soft/50' : 'hover:bg-paper')}>
                      <td className={td + (skipped ? ' whitespace-normal text-rose' : '')}>
                        {r.problem ? r.problem : r.already && !includeAlready ? `เคยสร้างไฟล์แล้ว (${r.item.sap_file_name ?? ''})` : 'พร้อม'}
                      </td>
                      <td className={td + ' tabular-nums'}>{r.item.encounter_id}</td>
                      <td className={td}>{r.live?.hn ?? '–'}</td>
                      <td className={td}>{r.item.patient_name}</td>
                      <td className={td}>{r.live?.claimNo ?? '–'}</td>
                      <td className={td + ' text-right tabular-nums'}>{money(r.item.total_amount)}</td>
                      <td className={td + ' text-right tabular-nums'}>{money(r.live?.claimAmount)}</td>
                      <td className={td + ' text-right tabular-nums'}>{amt && amt.a40 > 0 ? money(amt.a40) : '–'}</td>
                      <td className={td}>
                        {amt
                          ? amt.kind === 'short'
                            ? 'H + 09 + 40 + 11'
                            : amt.kind === 'equal'
                              ? 'H + 09 + 11 (ยอดเท่ากัน ไม่มี 40)'
                              : 'H + 09 + 11 (REP จ่ายมากกว่ายอดตั้งเบิก ตั้งตามยอดตั้งเบิก ไม่มี 40)'
                          : '–'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {missing.length > 0 && (
            <Notice>
              <b>ยังสร้างไฟล์ SAP ไม่ได้:</b> มี {missing.length} เคสที่ยังไม่มียอดตั้งเบิก — กลับไปใส่ยอดส่งเบิกที่หน้าหลักให้ครบก่อน แล้วกลับมาหน้านี้ (ระบบจับคู่ใหม่ให้เอง)
              <div className="mt-1 tabular-nums">
                {missing.map((r) => `${r.item.encounter_id}${r.live?.claimNo ? ` (${r.live.claimNo})` : ''}`).join(' · ')}
              </div>
            </Notice>
          )}
          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-surface p-4 text-sm">
            <div className="tabular-nums">
              09 รวม <b>{money(totals.a09)}</b> + 40 รวม <b>{money(totals.a40)}</b> = <b>{money(totals.a09 + totals.a40)}</b> · 11 รวม <b>{money(totals.a11)}</b>{' '}
              {Math.abs(totals.a09 + totals.a40 - totals.a11) < 0.005 ? '✓ สมดุล' : '✗ ไม่สมดุล'}
            </div>
            {needAck && (
              <label className="flex items-center gap-2 text-ink">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                รับทราบรายการที่สร้างไม่ได้/ไม่ผ่านด้านบนแล้ว
              </label>
            )}
            <Button type="button" onClick={() => void download()} disabled={ready.length === 0 || missing.length > 0 || (needAck && !ack)}>
              ดาวน์โหลด txt สำหรับ SAP ({ready.length} เคส)
            </Button>
          </div>
          {done && <div className="rounded-lg border border-line bg-brand-soft px-4 py-2 text-sm text-ink">{done}</div>}
        </>
      )}
    </div>
  )
}

function Card({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={'rounded-xl border p-4 ' + (warn ? 'border-rose/30 bg-rose-soft/50' : 'border-line bg-surface')}>
      <div className="text-xs text-ink/70">{label}</div>
      <div className="mt-1 text-lg font-bold tabular-nums text-ink">{value}</div>
      {sub && <div className="text-xs text-ink/70">{sub}</div>}
    </div>
  )
}

function Notice({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-rose/30 bg-rose-soft/50 px-4 py-2 text-sm text-rose">{children}</div>
}

/** รหัส error ที่ต้องแก้ (ก่อน 837) เป็นชิปเด่น ๆ · คำเตือน (837 / 83A / 926) แสดงเป็นจำนวนเล็ก ๆ ไม่ต้องแก้ */
function CodeChips({ msg }: { msg: string }) {
  const { codes, more } = splitMsg(msg)
  const errs = codes.filter((c) => c.kind === 'error')
  const warn = codes.length - errs.length + more
  if (errs.length === 0) return <span className="text-ink/40">{warn > 0 ? `เตือน ${warn} (ไม่ต้องแก้)` : '–'}</span>
  return (
    <div className="flex flex-wrap items-center gap-1">
      {errs.map((c, i) => (
        <span key={i} className="rounded-md border border-rose/40 bg-rose-soft px-1.5 py-0.5 font-mono text-[12px] font-semibold text-rose">
          {c.code}
          {c.detail ? `:${c.detail}` : ''}
        </span>
      ))}
      {warn > 0 && <span className="text-[11px] text-ink/40">+ เตือน {warn}</span>}
    </div>
  )
}

function DupCell({ info, skipped, onChange }: { info: DupInfo | undefined; skipped: boolean; onChange: (skip: boolean) => void }) {
  if (!info) return <span className="text-ink/40">–</span>
  return (
    <div className="space-y-1">
      <div className={info.needsDecision ? 'font-semibold text-rose' : 'font-semibold text-ink'}>{DUP_LABEL[info.flag]}</div>
      <div className="max-w-[320px] text-[12px] text-ink/70">{info.note}</div>
      {info.needsDecision && (
        <select
          value={skipped ? 'skip' : 'save'}
          onChange={(e) => onChange(e.target.value === 'skip')}
          className="rounded-md border border-ink/30 bg-surface px-2 py-1 text-xs text-ink"
        >
          <option value="skip">ข้าม (ไม่บันทึก)</option>
          <option value="save">บันทึก (ติดป้ายซ้ำ)</option>
        </select>
      )}
    </div>
  )
}
