import { useSyncExternalStore } from 'react'
import { decorate, fetchSkips, isReadyToImport, previewSheetAudit } from './sheetSync'

/**
 * จำนวนเคสในชีต Audit ที่ "พร้อมนำเข้า" (ยังไม่เคยบันทึกวัน Audit) — ใช้ร่วมกันระหว่างการ์ดแจ้งเตือนและป้ายบนปุ่ม "ดึง Audit จาก Sheet"
 * นับด้วยกติกาเดียวกับแท็บ "พร้อมนำเข้า" ในหน้าดึง Audit (isReadyToImport) — อ่านอย่างเดียว ไม่บันทึกอะไร
 */
export interface ReadyState {
  /** null = ยังไม่เคยตรวจสำเร็จ (หรือตรวจไม่ได้) */
  count: number | null
  checkedAt: number | null
  loading: boolean
}

let state: ReadyState = { count: null, checkedAt: null, loading: false }
const listeners = new Set<() => void>()
let inflight: Promise<void> | null = null

function set(next: Partial<ReadyState>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

/** ตรวจใหม่ — ถ้ากำลังตรวจอยู่จะรอรอบเดิม; ตรวจไม่ได้ (ฟังก์ชันซิงก์ล้ม/ไม่มีเน็ต) = เงียบ ไม่รบกวนผู้ใช้ */
export function refreshReadyToImport(): Promise<void> {
  if (inflight) return inflight
  set({ loading: true })
  inflight = (async () => {
    try {
      const [res, skips] = await Promise.all([previewSheetAudit(), fetchSkips()])
      const n = decorate(res.items, skips).filter(isReadyToImport).length
      set({ count: n, checkedAt: Date.now(), loading: false })
    } catch {
      set({ loading: false })
    } finally {
      inflight = null
    }
  })()
  return inflight
}

export function useReadyToImport(): ReadyState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}

/** ใช้ส่งสัญญาณ "เปิดหน้าดึง Audit" จากการ์ดแจ้งเตือนไปยังปุ่มในหน้าหลัก (ปุ่มอาจยังไม่ถูกสร้างตอนกด จึงฝากค่าไว้ใน sessionStorage ด้วย) */
export const OPEN_PULL_EVENT = 'ipd:open-sheet-pull'
const OPEN_PULL_KEY = 'ipd.openSheetPull'

export function requestOpenPull() {
  try {
    sessionStorage.setItem(OPEN_PULL_KEY, '1')
  } catch {
    /* ใช้ storage ไม่ได้ — ใช้ event อย่างเดียว */
  }
  window.dispatchEvent(new Event(OPEN_PULL_EVENT))
}

/** อ่านแล้วล้างค่าที่ฝากไว้ (true = มีคำขอเปิดค้างอยู่) */
export function consumeOpenPull(): boolean {
  try {
    if (sessionStorage.getItem(OPEN_PULL_KEY)) {
      sessionStorage.removeItem(OPEN_PULL_KEY)
      return true
    }
  } catch {
    /* ข้าม */
  }
  return false
}
