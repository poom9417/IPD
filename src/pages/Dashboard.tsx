import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { pairKey } from '../lib/pairKey'
import { useAuth } from '../contexts/AuthContext'
import StatCards from '../components/StatCards'
import FilterBar from '../components/FilterBar'
import AdmissionsTable from '../components/AdmissionsTable'
import AdmissionForm from '../components/AdmissionForm'
import CaseDetailModal from '../components/CaseDetailModal'
import ReceiveEditModal from '../components/ReceiveEditModal'
import BulkClaimUpload from '../components/BulkClaimUpload'
import ImportAdmissionsCsv from '../components/ImportAdmissionsCsv'
import PendingAssignmentsBanner from '../components/PendingAssignmentsBanner'
import type { Admission, CoverageMaster, PayerMaster } from '../lib/types'
import { exportAdmissionsToExcel } from '../lib/exportExcel'
import type { ClaimStage } from '../lib/claimStatus'
import {
  searchAdmissions,
  fetchAllMatching,
  fetchAdmissionLookup,
  type AdmissionFilters,
  type AdmissionStats,
} from '../lib/searchAdmissions'

const PAGE_SIZE = 50
export default function Dashboard() {
  const { role, session } = useAuth()
  const isAdmin = role === 'admin'
  const isAudit = role === 'audit'
  // ปุ่ม "เฉพาะสิทธิของฉัน": เฉพาะ admin / user — audit / viewer ไม่มีสิทธิที่ดูแลของตัวเอง
  const canFilterMine = role === 'admin' || role === 'user'
  // audit: อัพโหลดได้เฉพาะขั้น Audit + กดบันทึกวัน Audit ได้ | user: อัพโหลดได้เฉพาะรับเอกสาร/ส่งเบิก (ฐานข้อมูลบังคับซ้ำอีกชั้น)
  const canBulk = role === 'admin' || role === 'user' || isAudit
  const canMarkAudit = isAdmin || isAudit
  // admin + user: เพิ่มเคส / อัพโหลดสถานะเคลม (CSV) / กดรับเอกสาร ได้  |  เฉพาะ admin: นำเข้าเคส, แก้ไขเคส, จัดการผู้ใช้
  const canEdit = role === 'admin' || role === 'user'
  const canReceiveDoc = canEdit

  // admissions = เฉพาะแถวของหน้าที่แสดงอยู่ (ค้นหา/กรอง/เรียง/แบ่งหน้า ทำที่ DB ผ่าน search_admissions)
  const [admissions, setAdmissions] = useState<Admission[]>([])
  const [total, setTotal] = useState(0)
  const [grandTotal, setGrandTotal] = useState(0)
  const [stats, setStats] = useState<AdmissionStats | null>(null)
  const [divisions, setDivisions] = useState<string[]>([])
  const [fetching, setFetching] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [bulkLookup, setBulkLookup] = useState<Admission[]>([])
  const [bulkPreparing, setBulkPreparing] = useState(false)
  const reqId = useRef(0)
  const [coverageOptions, setCoverageOptions] = useState<CoverageMaster[]>([])
  const [payerOptions, setPayerOptions] = useState<PayerMaster[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Admission | null | undefined>(undefined)
  const [viewing, setViewing] = useState<Admission | null>(null)
  const [editingReceive, setEditingReceive] = useState<Admission | null>(null)
  const [showBulk, setShowBulk] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [myPairs, setMyPairs] = useState<Set<string>>(new Set())
  // เพิ่มค่านี้เมื่อยืนยันรับสิทธิจากแบนเนอร์ → โหลด "สิทธิของฉัน" ใหม่
  const [pairsTick, setPairsTick] = useState(0)
  const [onlyMine, setOnlyMine] = useState(false)

  const [search, setSearch] = useState('')
  const [division, setDivision] = useState('')
  const [dischargeFrom, setDischargeFrom] = useState('')
  const [dischargeTo, setDischargeTo] = useState('')
  const [coverages, setCoverages] = useState<string[]>([])
  const [payer, setPayer] = useState('')
  const [claimStage, setClaimStage] = useState<ClaimStage | ''>('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [pageState, setPageState] = useState<{ key: string; page: number }>({ key: '', page: 1 })

  // โหลดรายการสิทธิ/ผู้จ่ายสำหรับตัวกรองและฟอร์ม (ตารางเล็ก)
  async function loadMasters() {
    const [cov, pay] = await Promise.all([
      supabase.from('coverage_master').select('*').order('coverage_code'),
      supabase.from('payer_master').select('*').order('payer_id'),
    ])
    if (cov.error) throw cov.error
    if (pay.error) throw pay.error
    setCoverageOptions(cov.data ?? [])
    setPayerOptions(pay.data ?? [])
  }

  // รีโหลดหน้าปัจจุบัน (+ ตัวเลขสรุป) หลังบันทึก/นำเข้า/อัพโหลด
  function reload() {
    setReloadTick((t) => t + 1)
  }

  function loadData() {
    reload()
    loadMasters().catch((err) => setLoadError((err as { message?: string })?.message ?? 'โหลดข้อมูลไม่สำเร็จ'))
  }

  useEffect(() => {
    loadMasters().catch((err) => setLoadError((err as { message?: string })?.message ?? 'โหลดข้อมูลไม่สำเร็จ'))
  }, [])

  // รอให้พิมพ์ค้นหาหยุดก่อน ค่อยยิง query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // สิทธิที่ฉันดูแล (จากหน้า My job) ใช้กับปุ่มกรอง "เฉพาะสิทธิของฉัน"
  useEffect(() => {
    if (!session) return
    supabase
      .from('coverage_assignments')
      .select('coverage_code, payer_id')
      .eq('user_id', session.user.id)
      .then(({ data }) =>
        setMyPairs(new Set((data ?? []).map((r) => pairKey(r.coverage_code as string, r.payer_id as string)))),
      )
  }, [session, pairsTick])


  // กดปุ่ม "รับเอกสาร" + กรอกยอด → บันทึกวันที่วันนี้ (เวลาท้องถิ่น) และยอดรับเอกสารลง case_tracking
  // คืน true เมื่อสำเร็จ (ช่องกรอกยอดในตารางจะปิดเองเฉพาะตอนสำเร็จ)
  async function receiveDocument(a: Admission, amount: number): Promise<boolean> {
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const { data, error } = await supabase
      .from('case_tracking')
      .upsert(
        {
          admission_id: a.admission_id,
          encounter_id: a.encounter_id,
          document_received_date: today,
          document_received_amount: amount,
        },
        { onConflict: 'admission_id' },
      )
      .select()
      .single()
    if (error) {
      alert(`บันทึกรับเอกสารไม่สำเร็จ: ${error.message}`)
      return false
    }
    setAdmissions((prev) =>
      prev.map((x) =>
        x.admission_id === a.admission_id ? { ...x, case_tracking: data as Admission['case_tracking'] } : x,
      ),
    )
    reload()
    return true
  }

  // แก้ไข "วันที่รับเอกสาร" + "ยอด claim จาก HIS" ของเคสที่รับเอกสารแล้ว (admin + user)
  // ส่งเฉพาะ 2 ฟิลด์นี้ — ไม่แตะ audit / ส่งเบิก; ฐานข้อมูลบันทึก updated_by/updated_at ให้อัตโนมัติ
  async function updateReceived(a: Admission, date: string, amount: number): Promise<boolean> {
    const { data, error } = await supabase
      .from('case_tracking')
      .upsert(
        {
          admission_id: a.admission_id,
          encounter_id: a.encounter_id,
          document_received_date: date,
          document_received_amount: amount,
        },
        { onConflict: 'admission_id' },
      )
      .select()
      .single()
    if (error) {
      alert(`แก้ไขการรับเอกสารไม่สำเร็จ: ${error.message}`)
      return false
    }
    setAdmissions((prev) =>
      prev.map((x) =>
        x.admission_id === a.admission_id ? { ...x, case_tracking: data as Admission['case_tracking'] } : x,
      ),
    )
    // ถ้าเปิดหน้ารายละเอียดค้างอยู่ ให้แสดงค่าใหม่ทันที
    setViewing((v) =>
      v && v.admission_id === a.admission_id ? { ...v, case_tracking: data as Admission['case_tracking'] } : v,
    )
    reload()
    return true
  }

  // Export ตามตัวกรองบนหน้าจอ (ไม่ได้กรองอะไร = ทั้งหมด) — ดึงทุกแถวที่ตรงตัวกรองจาก DB ตอนกดปุ่ม ไม่แบ่งหน้า ไม่ตัด
  async function handleExport() {
    setExporting(true)
    try {
      const rows = await fetchAllMatching({ ...filters, search: search.trim() })
      exportAdmissionsToExcel(rows, 'ipd-ar-discharge', { auditOnly: isAudit })
    } catch (err) {
      alert(`Export ไม่สำเร็จ: ${(err as { message?: string })?.message ?? err}`)
    } finally {
      setExporting(false)
    }
  }

  // เปิดหน้าอัพโหลดสถานะเคลม: โหลดรายการเบาๆ (เลขเคส + ผู้จ่าย) ไว้จับคู่กับไฟล์ก่อน
  async function openBulk() {
    setBulkPreparing(true)
    try {
      setBulkLookup(await fetchAdmissionLookup())
      setShowBulk(true)
    } catch (err) {
      alert(`เตรียมข้อมูลไม่สำเร็จ: ${(err as { message?: string })?.message ?? err}`)
    } finally {
      setBulkPreparing(false)
    }
  }

  // role audit กดปุ่ม "Audit" → บันทึกวันที่วันนี้ลง audit_date (ไม่แตะฟิลด์อื่น)
  async function auditToday(a: Admission) {
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const { data, error } = await supabase
      .from('case_tracking')
      .upsert(
        { admission_id: a.admission_id, encounter_id: a.encounter_id, audit_date: today },
        { onConflict: 'admission_id' },
      )
      .select()
      .single()
    if (error) {
      alert(`บันทึกวัน Audit ไม่สำเร็จ: ${error.message}`)
      return
    }
    setAdmissions((prev) =>
      prev.map((x) =>
        x.admission_id === a.admission_id ? { ...x, case_tracking: data as Admission['case_tracking'] } : x,
      ),
    )
    reload()
  }

  // ตัวกรองที่ส่งให้ DB — วันจำหน่าย: เลือกช่วง → from..to, เลือกแค่วันเดียว → วันนั้นวันเดียว
  const filters = useMemo<AdmissionFilters>(() => {
    let from = dischargeFrom
    let to = dischargeTo
    if (from && to && from > to) [from, to] = [to, from]
    if (from && !to) to = from
    else if (!from && to) from = to
    return {
      search: debouncedSearch.trim(),
      division,
      from,
      to,
      coverages,
      payer,
      stage: claimStage,
      pairs: canFilterMine && onlyMine ? Array.from(myPairs) : null,
    }
  }, [debouncedSearch, division, dischargeFrom, dischargeTo, coverages, payer, claimStage, onlyMine, myPairs, canFilterMine])
  const filterKey = JSON.stringify(filters)

  // เปลี่ยนตัวกรองแล้วกลับไปหน้า 1 อัตโนมัติ (หน้าที่จำไว้ผูกกับตัวกรองชุดนั้น)
  const page = pageState.key === filterKey ? pageState.page : 1
  const setPage = (p: number) => setPageState({ key: filterKey, page: p })

  useEffect(() => {
    const id = ++reqId.current
    setFetching(true)
    setLoadError(null)
    searchAdmissions(filters, PAGE_SIZE, (page - 1) * PAGE_SIZE, true)
      .then((res) => {
        if (id !== reqId.current) return // มีคำขอใหม่กว่าแล้ว ทิ้งผลเก่า
        setAdmissions(res.rows)
        setTotal(res.total)
        setGrandTotal(res.grand_total)
        setStats(res.stats)
        if (res.divisions) setDivisions(res.divisions)
      })
      .catch((err) => {
        if (id !== reqId.current) return
        setLoadError((err as { message?: string })?.message ?? 'โหลดข้อมูลไม่สำเร็จ')
      })
      .finally(() => {
        if (id !== reqId.current) return
        setFetching(false)
        setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, page, reloadTick])

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  // ลบ/กรองจนหน้าปัจจุบันว่าง → ถอยไปหน้าสุดท้ายที่มีข้อมูล
  useEffect(() => {
    if (!fetching && page > pageCount) setPage(pageCount)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetching, page, pageCount])

  const hasActiveFilter = !!(
    search ||
    division ||
    dischargeFrom ||
    dischargeTo ||
    coverages.length ||
    payer ||
    claimStage ||
    (canFilterMine && onlyMine)
  )

  function clearFilters() {
    setSearch('')
    setDivision('')
    setDischargeFrom('')
    setDischargeTo('')
    setCoverages([])
    setPayer('')
    setClaimStage('')
    setOnlyMine(false)
  }

  return (
    <div>
      <main className="w-full space-y-5 px-4 py-6 sm:px-8">
        {/* แจ้งเตือน: สิทธิที่ Audit / Developer เลือกให้ รอยืนยัน (เฉพาะ admin / user) */}
        {canFilterMine && <PendingAssignmentsBanner onChanged={() => setPairsTick((t) => t + 1)} />}

        {/* สถิติคิดจากรายการที่กรองอยู่ */}
        <StatCards stats={stats} />

        <FilterBar
          search={search}
          onSearchChange={setSearch}
          division={division}
          onDivisionChange={setDivision}
          divisions={divisions}
          dischargeFrom={dischargeFrom}
          onDischargeFromChange={setDischargeFrom}
          dischargeTo={dischargeTo}
          onDischargeToChange={setDischargeTo}
          coverageOptions={coverageOptions}
          coverages={coverages}
          onCoveragesChange={setCoverages}
          payerOptions={payerOptions}
          payer={payer}
          onPayerChange={setPayer}
          claimStage={claimStage}
          onClaimStageChange={setClaimStage}
          onClear={clearFilters}
          hasActiveFilter={hasActiveFilter}
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-ink/70">
            แสดง {total.toLocaleString()} จาก {grandTotal.toLocaleString()} รายการ
          </div>
          <div className="flex flex-wrap gap-2">
            {canFilterMine && myPairs.size > 0 && (
              <button
                data-tour="only-mine"
                onClick={() => setOnlyMine((v) => !v)}
                className={
                  'whitespace-nowrap rounded-lg border px-4 py-2 text-sm font-medium transition-colors ' +
                  (onlyMine
                    ? 'border-ink bg-brand text-ink'
                    : 'border-ink/30 text-ink hover:bg-brand-soft hover:border-ink')
                }
              >
                เฉพาะสิทธิของฉัน ({myPairs.size})
              </button>
            )}
            <button
              data-tour="export"
              onClick={handleExport}
              disabled={loading || exporting || total === 0}
              title={
                hasActiveFilter
                  ? 'ส่งออกเฉพาะรายการที่ตรงกับตัวกรองบนหน้าจอ (ทุกหน้า)'
                  : 'ส่งออกทุกรายการ (ยังไม่ได้ตั้งตัวกรอง)'
              }
              className="whitespace-nowrap rounded-lg border border-ink/30 px-4 py-2 text-sm font-medium text-ink hover:bg-brand-soft hover:border-ink transition-colors disabled:opacity-40"
            >
              {exporting ? 'กำลังส่งออก…' : `⬇ Export Excel (${hasActiveFilter ? 'ตามตัวกรอง' : 'ทั้งหมด'} ${total.toLocaleString()})`}
            </button>
            {isAdmin && (
              <button
                data-tour="import"
                onClick={() => setShowImport(true)}
                className="whitespace-nowrap rounded-lg border border-ink/30 px-4 py-2 text-sm font-medium text-ink hover:bg-brand-soft hover:border-ink transition-colors"
              >
                นำเข้าเคสใหม่ (CSV)
              </button>
            )}
            {canBulk && (
              <button
                data-tour="bulk"
                onClick={openBulk}
                disabled={bulkPreparing}
                className="whitespace-nowrap rounded-lg border border-ink/30 px-4 py-2 text-sm font-medium text-ink hover:bg-brand-soft hover:border-ink transition-colors disabled:opacity-40"
              >
                {bulkPreparing ? 'กำลังเตรียมข้อมูล…' : isAudit ? 'อัพโหลดวัน Audit (CSV)' : 'อัพโหลดสถานะเคลม (CSV)'}
              </button>
            )}
            {canEdit && (
              <>
                <button
                  data-tour="add-case"
                  onClick={() => setEditing(null)}
                  className="whitespace-nowrap rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-ink hover:bg-brand-dark transition-colors"
                >
                  + เพิ่มเคส
                </button>
              </>
            )}
          </div>
        </div>

        {loadError && (
          <div className="flex items-center justify-between rounded-lg border border-rose/30 bg-rose-soft/50 px-4 py-2 text-sm text-rose">
            <span>โหลดข้อมูลไม่สำเร็จ: {loadError}</span>
            <button onClick={reload} className="underline">
              ลองใหม่
            </button>
          </div>
        )}

        <div className={fetching && !loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        <AdmissionsTable
          admissions={admissions}
          loading={loading}
          isAdmin={isAdmin}
          canReceive={canReceiveDoc}
          onEdit={(a) => setEditing(a)}
          onView={(a) => setViewing(a)}
          onReceiveDoc={receiveDocument}
          onEditReceive={(a) => setEditingReceive(a)}
          canAudit={canMarkAudit}
          onAuditToday={auditToday}
        />
        </div>

        {!loading && total > PAGE_SIZE && (
          <div className="flex items-center justify-between text-sm text-ink/60">
            <span>
              หน้า {currentPage} / {pageCount}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(currentPage - 1)}
                disabled={currentPage <= 1}
                className="rounded-lg border border-line px-3 py-1.5 hover:bg-paper disabled:opacity-40"
              >
                ก่อนหน้า
              </button>
              <button
                onClick={() => setPage(currentPage + 1)}
                disabled={currentPage >= pageCount}
                className="rounded-lg border border-line px-3 py-1.5 hover:bg-paper disabled:opacity-40"
              >
                ถัดไป
              </button>
            </div>
          </div>
        )}
      </main>

      {showImport && (
        <ImportAdmissionsCsv
          onClose={() => setShowImport(false)}
          onDone={() => {
            // ไม่ปิด modal เพื่อให้เห็นสรุปผลการนำเข้า
            loadData()
          }}
        />
      )}

      {showBulk && (
        <BulkClaimUpload
          admissions={bulkLookup}
          allowedStages={isAudit ? ['audit'] : role === 'user' ? ['document', 'submission'] : undefined}
          onClose={() => setShowBulk(false)}
          onDone={() => {
            setShowBulk(false)
            setBulkLookup([])
            loadData()
          }}
        />
      )}

      {viewing && (
        <CaseDetailModal
          admission={viewing}
          onClose={() => setViewing(null)}
          onEdit={
            isAdmin
              ? (a) => {
                  setViewing(null)
                  setEditing(a)
                }
              : undefined
          }
          onEditReceive={canReceiveDoc ? (a) => setEditingReceive(a) : undefined}
        />
      )}

      {editingReceive && (
        <ReceiveEditModal
          admission={editingReceive}
          onClose={() => setEditingReceive(null)}
          onSave={updateReceived}
        />
      )}

      {editing !== undefined && (
        <AdmissionForm
          admission={editing}
          coverageOptions={coverageOptions}
          payerOptions={payerOptions}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined)
            loadData()
          }}
        />
      )}
    </div>
  )
}
