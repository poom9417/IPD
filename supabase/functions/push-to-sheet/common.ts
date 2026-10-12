import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** error ที่มีสถานะ HTTP + ข้อความภาษาไทยให้ผู้ใช้อ่านรู้เรื่อง */
export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status)
  console.error(e)
  return json({ ok: false, error: `เกิดข้อผิดพลาดภายใน: ${e instanceof Error ? e.message : String(e)}` }, 500)
}

export interface Caller {
  admin: SupabaseClient
  email: string
}

/** ตรวจ JWT ของผู้เรียก แล้วอนุญาตเฉพาะ role จริงใน DB = admin / developer */
export async function requireAdmin(req: Request): Promise<Caller> {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) throw new HttpError(500, 'ตั้งค่าเซิร์ฟเวอร์ไม่ครบ (SUPABASE_URL / SERVICE_ROLE_KEY)')
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) throw new HttpError(401, 'ไม่พบข้อมูลการเข้าสู่ระบบ')
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: u, error } = await admin.auth.getUser(token)
  if (error || !u?.user) throw new HttpError(401, 'เข้าสู่ระบบหมดอายุ — รีเฟรชหน้าแล้วลองใหม่')
  const { data: row, error: rErr } = await admin.from('app_users').select('role,email').eq('id', u.user.id).maybeSingle()
  if (rErr) throw new HttpError(500, `ตรวจสิทธิ์ผู้ใช้ไม่สำเร็จ: ${rErr.message}`)
  if (!row || !['admin', 'developer'].includes(row.role)) throw new HttpError(403, 'ทำได้เฉพาะ admin / developer')
  return { admin, email: (row.email as string | null) ?? u.user.email ?? '' }
}

/** บันทึกสถานะซิงก์ — ถ้าตาราง sheet_sync_state ยังไม่ถูกสร้างจะข้ามเงียบๆ (ไม่ให้การซิงก์ล้มเพราะเรื่องนี้) */
export async function saveState(admin: SupabaseClient, patch: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await admin.from('sheet_sync_state').update(patch).eq('id', 1)
    if (error) console.warn('sheet_sync_state update skipped:', error.message)
  } catch (e) {
    console.warn('sheet_sync_state update failed:', e)
  }
}
