import { HttpError } from './common.ts'

const enc = new TextEncoder()
let saEmail = 'อีเมล Service Account'

function b64url(input: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof input === 'string' ? enc.encode(input) : new Uint8Array(input)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface ServiceAccount {
  client_email: string
  private_key: string
}

export function loadServiceAccount(): ServiceAccount {
  const raw = Deno.env.get('GOOGLE_SA_JSON')
  if (!raw) throw new HttpError(500, 'ยังไม่ได้ตั้งค่า secret GOOGLE_SA_JSON ใน Supabase (Edge Functions > Secrets)')
  let sa: Partial<ServiceAccount>
  try {
    sa = JSON.parse(raw)
  } catch {
    throw new HttpError(500, 'secret GOOGLE_SA_JSON อ่านเป็น JSON ไม่ได้ — ต้องวางเนื้อหาทั้งไฟล์ .json (ตั้งแต่ { ถึง })')
  }
  if (!sa.client_email || !sa.private_key) {
    throw new HttpError(500, 'secret GOOGLE_SA_JSON ไม่มี client_email / private_key — ตรวจว่าวางไฟล์ key ของ Service Account ถูกไฟล์')
  }
  return { client_email: sa.client_email, private_key: sa.private_key }
}

export function loadSheetId(): string {
  const id = Deno.env.get('SHEET_ID')?.trim()
  if (!id) throw new HttpError(500, 'ยังไม่ได้ตั้งค่า secret SHEET_ID ใน Supabase (Edge Functions > Secrets)')
  return id
}

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

export async function getAccessToken(sa: ServiceAccount): Promise<string> {
  saEmail = sa.client_email
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3300,
    }),
  )
  let key: CryptoKey
  try {
    key = await crypto.subtle.importKey(
      'pkcs8',
      pemToDer(sa.private_key),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    )
  } catch {
    throw new HttpError(500, 'อ่าน private_key ของ Service Account ไม่ได้ — ไฟล์ key อาจวางไม่ครบหรือถูกแก้ไข')
  }
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${header}.${claim}`))
  const assertion = `${header}.${claim}.${b64url(sig)}`
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) {
    throw new HttpError(502, `ขอสิทธิ์จาก Google ไม่สำเร็จ: ${body.error_description ?? body.error ?? res.status}`)
  }
  return body.access_token as string
}

async function sheetsFetch(token: string, path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const text = await res.text()
  let body: any = {}
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const msg: string = body?.error?.message ?? text.slice(0, 200)
    if (res.status === 400 && /protected cell|protected range|protected sheet/i.test(msg)) {
      throw new HttpError(
        502,
        `แท็บนี้ถูกตั้งป้องกัน (Protected) และ Service Account ไม่อยู่ในรายชื่อผู้แก้ไขได้ — ไปที่ ข้อมูล > ชีตและช่วงที่ป้องกัน > เลือกแท็บนี้ > ตั้งค่าสิทธิ์ > จำกัดผู้ที่แก้ไขได้ แล้วเพิ่ม ${saEmail} จากนั้นกดส่งใหม่`,
      )
    }
    if (res.status === 403) {
      throw new HttpError(502, 'Service Account ไม่มีสิทธิ์เข้าชีต — แชร์ชีตให้อีเมล Service Account เป็นผู้แก้ไข (Editor) แล้วลองใหม่')
    }
    if (res.status === 404) throw new HttpError(502, 'ไม่พบ Google Sheet ตาม SHEET_ID — ตรวจค่า secret SHEET_ID')
    if (res.status === 400 && /Unable to parse range|not found/i.test(msg)) {
      throw new HttpError(502, `ไม่พบแท็บที่ต้องการในชีต (${msg})`)
    }
    throw new HttpError(502, `Google Sheets ตอบกลับผิดพลาด (${res.status}): ${msg}`)
  }
  return body
}

export interface TabInfo {
  sheetId: number
  title: string
  rowCount: number
  columnCount: number
}

export async function listTabs(token: string, sid: string): Promise<TabInfo[]> {
  const meta = await sheetsFetch(token, `${sid}?fields=sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))`)
  return (meta.sheets ?? []).map((s: any) => ({
    sheetId: s.properties.sheetId,
    title: s.properties.title,
    rowCount: s.properties.gridProperties?.rowCount ?? 1000,
    columnCount: s.properties.gridProperties?.columnCount ?? 26,
  }))
}

export function findTab(tabs: TabInfo[], title: string): TabInfo {
  const t = tabs.find((x) => x.title === title)
  if (!t) {
    throw new HttpError(
      502,
      `ไม่พบแท็บ "${title}" ในชีต (แท็บที่มี: ${tabs.map((x) => x.title).join(', ') || 'ไม่มี'}) — อย่าเปลี่ยนชื่อแท็บนี้`,
    )
  }
  return t
}

const q = (tab: string, range: string) => encodeURIComponent(`'${tab.replace(/'/g, "''")}'!${range}`)

/** อ่านค่าแบบดิบ: วันที่เป็นเลข serial (ไม่ผ่านรูปแบบการแสดงผล จึงไม่สลับวัน/เดือน) */
export async function getValues(token: string, sid: string, tab: string, range: string): Promise<unknown[][]> {
  const r = await sheetsFetch(
    token,
    `${sid}/values/${q(tab, range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER&majorDimension=ROWS`,
  )
  return (r.values ?? []) as unknown[][]
}

export async function updateValues(token: string, sid: string, tab: string, range: string, values: unknown[][]): Promise<void> {
  await sheetsFetch(token, `${sid}/values/${q(tab, range)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ range: `'${tab}'!${range}`, majorDimension: 'ROWS', values }),
  })
}

/** เขียนหลายช่วงในคำขอเดียว (values.batchUpdate, RAW) */
export async function batchUpdateValues(
  token: string,
  sid: string,
  tab: string,
  data: { range: string; values: unknown[][] }[],
): Promise<void> {
  if (data.length === 0) return
  await sheetsFetch(token, `${sid}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: data.map((d) => ({ range: `'${tab.replace(/'/g, "''")}'!${d.range}`, majorDimension: 'ROWS', values: d.values })),
    }),
  })
}

export async function clearValues(token: string, sid: string, tab: string, range: string): Promise<void> {
  await sheetsFetch(token, `${sid}/values/${q(tab, range)}:clear`, { method: 'POST', body: '{}' })
}

export async function batchUpdate(token: string, sid: string, requests: unknown[]): Promise<void> {
  if (requests.length === 0) return
  await sheetsFetch(token, `${sid}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) })
}

/** วันที่ ISO (yyyy-mm-dd) → เลข serial ของ Google Sheets (นับจาก 1899-12-30) */
export function isoToSerial(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86400000) + 25569
}

/** เลข serial → yyyy-mm-dd (UTC ล้วน ไม่มีเรื่องโซนเวลา) */
export function serialToIso(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400000)
  return new Date(ms).toISOString().slice(0, 10)
}
