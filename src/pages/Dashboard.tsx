import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import Navbar from '../components/Navbar'
import StatCards from '../components/StatCards'
import FilterBar from '../components/FilterBar'
import AdmissionsTable from '../components/AdmissionsTable'
import AdmissionForm from '../components/AdmissionForm'
import BulkClaimUpload from '../components/BulkClaimUpload'
import ImportAdmissionsCsv from '../components/ImportAdmissionsCsv'
import UserManagement from '../components/UserManagement'
import type { Admission, CoverageMaster, PayerMaster } from '../lib/types'
import { exportAdmissionsToExcel } from '../lib/exportExcel'

export default function Dashboard() {
  const { role } = useAuth()
  const isAdmin = role === 'admin'

  const [admissions, setAdmissions] = useState<Admission[]>([])
  const [coverageOptions, setCoverageOptions] = useState<CoverageMaster[]>([])
  const [payerOptions, setPayerOptions] = useState<PayerMaster[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Admission | null | undefined>(undefined)
  const [showBulk, setShowBulk] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showUsers, setShowUsers] = useState(false)

  const [search, setSearch] = useState('')
  const [division, setDivision] = useState('')
  const [dischargeFrom, setDischargeFrom] = useState('')
  const [dischargeTo, setDischargeTo] = useState('')
  const [coverages, setCoverages] = useState<string[]>([])

  async function loadData() {
    setLoading(true)
    const [{ data: admissionsData }, { data: coverageData }, { data: payerData }] = await Promise.all([
      supabase
        .from('admissions')
        .select('*, patients(*), coverage_master(*), payer_master(*), case_tracking(*)')
        .order('admit_date', { ascending: false }),
      supabase.from('coverage_master').select('*').order('coverage_code'),
      supabase.from('payer_master').select('*').order('payer_id'),
    ])
    setAdmissions((admissionsData as unknown as Admission[]) ?? [])
    setCoverageOptions(coverageData ?? [])
    setPayerOptions(payerData ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [])

  // กดปุ่ม "รับเอกสาร" → บันทึกวันที่วันนี้ (เวลาท้องถิ่น) ลง case_tracking ทันที
  async function receiveDocument(a: Admission) {
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const { data, error } = await supabase
      .from('case_tracking')
      .upsert(
        { admission_id: a.admission_id, encounter_id: a.encounter_id, document_received_date: today },
        { onConflict: 'admission_id' },
      )
      .select()
      .single()
    if (error) {
      alert(`บันทึกรับเอกสารไม่สำเร็จ: ${error.message}`)
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
          a.patients?.full_name.toLowerCase().includes(q) ||
          String(a.encounter_id).includes(q)
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
      return true
    })
  }, [admissions, search, division, dischargeFrom, dischargeTo, coverages])

  const hasActiveFilter = !!(search || division || dischargeFrom || dischargeTo || coverages.length)

  function clearFilters() {
    setSearch('')
    setDivision('')
    setDischargeFrom('')
    setDischargeTo('')
    setCoverages([])
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6">
        <StatCards admissions={admissions} />

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
          onClear={clearFilters}
          hasActiveFilter={hasActiveFilter}
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-ink/60">
            แสดง {filtered.length.toLocaleString()} จาก {admissions.length.toLocaleString()} รายการ
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => exportAdmissionsToExcel(filtered)}
              disabled={filtered.length === 0}
              className="whitespace-nowrap rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink/70 hover:bg-paper transition-colors disabled:opacity-40"
            >
              ⬇ Export Excel
            </button>
            {isAdmin && (
              <>
                <button
                  onClick={() => setShowUsers(true)}
                  className="whitespace-nowrap rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink/70 hover:bg-paper transition-colors"
                >
                  จัดการสิทธิ์ผู้ใช้
                </button>
                <button
                  onClick={() => setShowImport(true)}
                  className="whitespace-nowrap rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink/70 hover:bg-paper transition-colors"
                >
                  นำเข้าเคสใหม่ (CSV)
                </button>
                <button
                  onClick={() => setShowBulk(true)}
                  className="whitespace-nowrap rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink/70 hover:bg-paper transition-colors"
                >
                  อัพโหลดสถานะเคลม (CSV)
                </button>
                <button
                  onClick={() => setEditing(null)}
                  className="whitespace-nowrap rounded-lg bg-teal-dark px-4 py-2 text-sm font-medium text-white hover:bg-teal transition-colors"
                >
                  + เพิ่มเคส
                </button>
              </>
            )}
          </div>
        </div>

        <AdmissionsTable
          admissions={filtered}
          loading={loading}
          isAdmin={isAdmin}
          onEdit={(a) => setEditing(a)}
          onReceiveDoc={receiveDocument}
        />
      </main>

      {showUsers && <UserManagement onClose={() => setShowUsers(false)} />}

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
          onClose={() => setShowBulk(false)}
          onDone={() => {
            setShowBulk(false)
            loadData()
          }}
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
