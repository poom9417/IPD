import { useCallback, useRef, useState } from 'react'
import { supabase } from './supabaseClient'

// ---------- ผลจาก Edge Function ----------
export interface PushResult {
  ok: true
  rows: number
  at: string
  /** incremental = วางต่อท้าย/แก้แถวเดิม, rebuild = เขียนชีตใหม่ทั้งหมด (ฟังก์ชันรุ่นเก่าไม่ส่งฟิลด์เหล่านี้มา) */
  mode?: 'incremental' | 'rebuild'
  appended?: number
  updated?: number
  voided?: number
  restored?: number
  warnings?: string[]
}

export type PushMode = 'rebuild'

export interface PullTarget {
  admission_id: number
  coverage_code: string
  payer_id: string
  existing: string | null
  state: 'new' | 'same' | 'conflict'
}

export interface PullItem {
  row: number
  hn: string
  an: number | null
  encounter_id: number | null
  name: string
  sithi: string
  audit_date: string | null
  status: 'ok' | 'warn' | 'error'
  messages: string[]
  /** รหัสเรื่องที่ต้องตรวจ (ฟังก์ชันรุ่นเก่าอาจไม่ส่งมา) */
  flags?: string[]
  targets: PullTarget[]
  ignored?: string
}

export interface PullResult {
  ok: true
  summary: { total: number; ok: number; warn: number; error: number; ignored: number }
  items: PullItem[]
}

export interface SyncState {
  last_push_at: string | null
  last_push_by: string | null
  last_push_rows: number | null
  last_push_ok: boolean | null
  last_push_error: string | null
  last_pull_at: string | null
  last_pull_by: string | null
  last_pull_rows: number | null
}

// เรียก Edge Function แล้วแปลง error ให้เป็นข้อความไทยที่อ่านรู้เรื่อง (ฟังก์ชันส่ง {ok:false, error} กลับมาเสมอ)
async function callFn<T>(name: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    let msg = error.message
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = (await ctx.json()) as { error?: string }
        if (body?.error) msg = body.error
      } catch {
        /* ใช้ข้อความเดิม */
      }
    }
    if (/Failed to send a request|Failed to fetch/i.test(msg)) {
      msg = 'เชื่อมต่อฟังก์ชันซิงก์ไม่ได้ — ตรวจอินเทอร์เน็ต หรือฟังก์ชันยังไม่ได้ deploy'
    }
    throw new Error(msg)
  }
  const res = data as { ok?: boolean; error?: string } | null
  if (!res?.ok) throw new Error(res?.error ?? 'ไม่ทราบสาเหตุ')
  return data as T
}

export const pushToSheet = (mode?: PushMode) => callFn<PushResult>('push-to-sheet', mode ? { mode } : {})
export const previewSheetAudit = () => callFn<PullResult>('pull-from-sheet')

/** อ่านสถานะซิงก์ล่าสุด — ถ้ายังไม่ได้สร้างตาราง sheet_sync_state จะคืน null (ไม่ถือเป็น error) */
export async function fetchSyncState(): Promise<SyncState | null> {
  const { data, error } = await supabase.from('sheet_sync_state').select('*').eq('id', 1).maybeSingle()
  if (error) return null
  return (data as SyncState | null) ?? null
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function fmtIsoDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

// ---------- ส่งไป Sheet (ใช้ซ้ำทั้งปุ่มกดเอง และอัตโนมัติหลังนำเข้า/แก้เคส) ----------
export interface PushStatus {
  phase: 'idle' | 'running' | 'ok' | 'error'
  message: string
  at?: string
}

/**
 * ส่งไป Sheet แบบกันซ้อน: ถ้าสั่งส่งซ้ำระหว่างที่กำลังส่งอยู่ จะรอให้รอบนี้จบแล้วส่งอีก 1 รอบ (ข้อมูลล่าสุดไม่ตกหล่น)
 * enabled = false (เช่น role ที่ไม่ใช่ admin/developer) → ไม่ทำอะไร
 */
function pushMessage(r: PushResult): string {
  let msg: string
  if (r.mode === 'rebuild') {
    msg = `สร้างชีตใหม่ทั้งหมดแล้ว ${r.rows.toLocaleString()} แถว`
  } else if (r.mode === 'incremental') {
    const parts = [
      r.appended ? `เพิ่มใหม่ ${r.appended.toLocaleString()}` : '',
      r.updated ? `แก้ข้อมูลเดิม ${r.updated.toLocaleString()}` : '',
      r.voided ? `ทำสีแดง (ไม่เข้าเงื่อนไขแล้ว) ${r.voided.toLocaleString()}` : '',
      r.restored ? `คืนสถานะ ${r.restored.toLocaleString()}` : '',
    ].filter(Boolean)
    msg = parts.length > 0 ? `ส่งไป Google Sheet แล้ว: ${parts.join(' · ')}` : 'ชีตเป็นข้อมูลล่าสุดอยู่แล้ว ไม่มีอะไรต้องเปลี่ยน'
  } else {
    msg = `ส่งไป Google Sheet แล้ว ${r.rows.toLocaleString()} แถว`
  }
  if (r.warnings && r.warnings.length > 0) msg += ` ⚠ ${r.warnings.join(' ')}`
  return msg
}

export function useSheetPush(enabled: boolean) {
  const [status, setStatus] = useState<PushStatus>({ phase: 'idle', message: '' })
  const running = useRef(false)
  const again = useRef(false)
  const nextMode = useRef<PushMode | undefined>(undefined)

  const push = useCallback(async (mode?: PushMode) => {
    if (!enabled) return
    if (running.current) {
      again.current = true
      if (mode) nextMode.current = mode // สั่งสร้างใหม่ซ้อนมา → รอบถัดไปทำแบบสร้างใหม่
      return
    }
    nextMode.current = mode
    running.current = true
    try {
      do {
        again.current = false
        const thisMode = nextMode.current
        nextMode.current = undefined
        setStatus({ phase: 'running', message: 'กำลังส่งข้อมูลไป Google Sheet…' })
        try {
          const r = await pushToSheet(thisMode)
          setStatus({ phase: 'ok', message: pushMessage(r), at: r.at })
        } catch (e) {
          setStatus({ phase: 'error', message: `ส่งไป Google Sheet ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` })
        }
      } while (again.current)
    } finally {
      running.current = false
    }
  }, [enabled])

  return { status, push }
}
