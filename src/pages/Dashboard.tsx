import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { pairKey } from '../lib/pairKey'
import { useAuth } from '../contexts/AuthContext'
import StatCards from '../components/StatCards'
import FilterBar from '../components/FilterBar'
import AdmissionsTable from '../components/AdmissionsTable'
import AdmissionForm from '../components/AdmissionForm'
import CaseDetailModal from '../components/CaseDetailModal'
import BulkClaimUpload from '../components/BulkClaimUpload'
import ImportAdmissionsCsv from '../components/ImportAdmissionsCsv'
import type { Admission, CoverageMaster, PayerMaster } from '../lib/types'
import { exportAllToExcel } from '../lib/exportExcel'
import { getClaimStage, type ClaimStage } from '../lib/claimStatus'

const PAGE_SIZE = 50
const FETCH_CHUNK = 1000 // Supabase/PostgREST คืนสูงสุด 1,000 แถวต่อคำขอ ต้องดึงเป็นช่วงๆ

// ดึง admissions ทั้งหมด — ถ้าดึงครั้งเดียวจะถูกตัดที่ 1,000 แถวโดยไม่มี error
async function fetchAllAdmissions(): Promise<Admission[]> {
  const all: Admission[] = []
  for (let from = 0; ; from += FETCH_CHUNK) {
    const { data, error } = await supabase
      .from('admissions')
      .select('*, patients(*), coverage_master(*), payer_master(*), case_tracking(*)')
      .order('admit_date', { ascending: false })
      .order('admission_id', { ascending: false }) // tie-breaker ให้ลำดับคงที่ระหว่างหน้า
      .range(from, from + FETCH_CHUNK - 1)
    if (error) throw error
    const chunk = (data as unknown as Admission[]) ?? []
    all.push(...chunk)
    if (chunk.length < FETCH_CHUNK) break
  }
  return all
}

export default function Dashboard() {
  const { role, session } = useAuth()
  const isAdmin = role === 'admin'
  const isAudit = role === 'audit'
  // audit: อัพโหลดได้เฉพาะขั้น Audit + กดบันทึกวัน Audit ได้ | user: อัพโหลดได้เฉพาะรับเอกสาร/ส่งเบิก (ฐานข้อมูลบังคับซ้ำอีกชั้น)
  const canBulk = role === 'admin' || role === 'user' || isAudit
  const canMarkAudit = isAdmin || isAudit
  // admin + user: เพิ่มเคส / อัพโหลดสถานะเคลม (CSV) / กดรับเอกสาร ได้  |  เฉพาะ admin: นำเข้าเคส, แก้ไขเคส, จัดการผู้ใช้
  const canEdit = role === 'admin' || role === 'user'
  const canReceiveDoc = canEdit

  const [admissions, setAdmissions] = useState<Admission[]>([])
  const [coverageOptions, setCoverageOptions] = useState<CoverageMaster[]>([])
  const [payerOptions, setPayerOptions] = useState<PayerMaster[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Admission | null | undefined>(undefined)
  const [viewing, setViewing] = useState<Admission | null>(null)
  const [showBulk, setShowBulk] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [myPairs, setMyPairs] = useState<Set<string>>(new Set())
  const [onlyMine, setOnlyMine] = useState(false)
  const [exporting, setExporting] = useState(false)

  const [search, setSearch] = useState('')
  const [division, setDivision] = useState('')
  const [dischargeFrom, setDischargeFrom] = useState('')
  const [dischargeTo, setDischargeTo] = useState('')
  const [coverages, setCoverages] = useState<string[]>([])
  const [payer, setPayer] = useState('')
  const [claimStage, setClaimStage] = useState<ClaimStage | ''>('')
  const [page, setPage] = useState(1)

  async function loadData() {
    setLoading(true)
    setLoadError(null)
    try {
      const [rows, cov, pay] = await Promise.all([
        fetchAllAdmissions(),
        supabase.from('coverage_master').select('*').order('coverage_code'),
        supabase.from('payer_master').select('*').order('payer_id'),
      ])
      if (cov.error) throw cov.error
      if (pay.error) throw pay.error
      setAdmissions(rows)
      setCoverageOptions(cov.data ?? [])
      setPayerOptions(pay.data ?? [])
    } catch (err) {
      setLoadError((err as { message?: string })?.message ?? 'โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

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
  }, [session])


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
    return true
  }

  // Export ข้อมูลทั้งหมด: ดึงสดจากฐานข้อมูลทุกตาราง ไม่ผ่านตัวกรอง/ไม่จำกัดแถว
  async function handleExport() {
    setExporting(true)
    try {
      await exportAllToExcel()
    } catch (err) {
      alert(`Export ไม่สำเร็จ: ${(err as { message?: string })?.message ?? err}`)
    } finally {
      setExporting(false)
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
  }

  const divisions = useMemo(
    () => Array.from(new Set(admissions.map((a) => a.division_code).filter((d): d is string => !!d))).sort(),
    [admissions],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()

    // วันจำหน่าย: เลือกช่วง → from..to, เลือกแค่วันเดียว (เริ่มหรือสิ้นสุดอย่างใดอย่างหนึ่ง) → วันนั้นวันเดียว
    let from = dischargeFrom
    let to = dischargeTo
    if (from && to && from > to) [from, to] = [to, from]
    const singleDay = from && !to ? from : !from && to ? to : ''

    return admissions.filter((a) => {
      if (
        q &&
        !(
          a.hn.toLowerCase().includes(q) ||
          (a.patients?.full_name ?? '').toLowerCase().includes(q) ||
          String(a.encounter_id).includes(q) ||
          String(a.an).includes(q)
        )
      ) {
        return false
      }
      if (division && a.division_code !== division) return false

      if (from || to) {
        const d = a.discharge_date?.slice(0, 10)
        if (!d) return false
        if (singleDay) {
          if (d !== singleDay) return false
        } else if (d < from || d > to) {
          return false
        }
      }

      if (coverages.length > 0 && !coverages.includes(a.coverage_code)) return false
      if (onlyMine && !myPairs.has(pairKey(a.coverage_code, a.payer_id))) return false
      if (payer && a.payer_id !== payer) return false
      if (claimStage && getClaimStage(a) !== claimStage) return false
      return true
    })
  }, [admissions, search, division, dischargeFrom, dischargeTo, coverages, payer, claimStage, onlyMine, myPairs])

  // เปลี่ยน filter แล้วกลับไปหน้า 1
  useEffect(() => {
    setPage(1)
  }, [search, division, dischargeFrom, dischargeTo, coverages, payer, claimStage, onlyMine])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const paged = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage],
  )

  const hasActiveFilter = !!(
    search ||
    division ||
    dischargeFrom ||
    dischargeTo ||
    coverages.length ||
    payer ||
    claimStage ||
    onlyMine
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
        {/* สถิติคิดจากรายการที่กรองอยู่ */}
        <StatCards admissions={filtered} />

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
            แสดง {filtered.length.toLocaleString()} จาก {admissions.length.toLocaleString()} รายการ
          </div>
          <div className="flex flex-wrap gap-2">
            {myPairs.size > 0 && (
              <button
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
              onClick={handleExport}
              disabled={exporting}
              title="ส่งออกข้อมูลทั้งหมดในระบบ (ไม่ขึ้นกับตัวกรองบนหน้าจอ)"
              className="whitespace-nowrap rounded-lg border border-ink/30 px-4 py-2 text-sm font-medium text-ink hover:bg-brand-soft hover:border-ink transition-colors disabled:opacity-40"
            >
              {exporting ? 'กำลังเตรียมไฟล์…' : '⬇ Export Excel (ทั้งหมด)'}
            </button>
            {isAdmin && (
              <button
                onClick={() => setShowImport(true)}
                className="whitespace-nowrap rounded-lg border border-ink/30 px-4 py-2 text-sm font-medium text-ink hover:bg-brand-soft hover:border-ink transition-colors"
              >
                นำเข้าเคสใหม่ (CSV)
              </button>
            )}
            {canBulk && (
              <button
                onClick={() => setShowBulk(true)}
                className="whitespace-nowrap rounded-lg border border-ink/30 px-4 py-2 text-sm font-medium text-ink hover:bg-brand-soft hover:border-ink transition-colors"
              >
                {isAudit ? 'อัพโหลดวัน Audit (CSV)' : 'อัพโหลดสถานะเคลม (CSV)'}
              </button>
            )}
            {canEdit && (
              <>
                <button
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
            <button onClick={loadData} className="underline">
              ลองใหม่
            </button>
          </div>
        )}

        <AdmissionsTable
          admissions={paged}
          loading={loading}
          isAdmin={isAdmin}
          canReceive={canReceiveDoc}
          onEdit={(a) => setEditing(a)}
          onView={(a) => setViewing(a)}
          onReceiveDoc={receiveDocument}
          canAudit={canMarkAudit}
          onAuditToday={auditToday}
        />

        {!loading && filtered.length > PAGE_SIZE && (
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
          admissions={admissions}
          allowedStages={isAudit ? ['audit'] : role === 'user' ? ['document', 'submission'] : undefined}
          onClose={() => setShowBulk(false)}
          onDone={() => {
            setShowBulk(false)
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
