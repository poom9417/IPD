import { createClient } from '@supabase/supabase-js'

const rawUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

let urlIsValid = false
if (rawUrl) {
  try {
    // eslint-disable-next-line no-new
    new URL(rawUrl)
    urlIsValid = true
  } catch {
    urlIsValid = false
  }
}

export const supabaseConfigError = !rawUrl
  ? 'ไม่พบ VITE_SUPABASE_URL — ไปตั้งค่าที่ Vercel Project Settings > Environment Variables แล้ว Redeploy ใหม่ (ตั้งค่าอย่างเดียวไม่พอ ต้อง deploy ซ้ำ)'
  : !urlIsValid
    ? `VITE_SUPABASE_URL ไม่ใช่ URL ที่ถูกต้อง ("${rawUrl}") — เช็คว่าไม่มีเครื่องหมายคำพูดหรือช่องว่างติดมาตอนวางค่าใน Vercel`
    : !rawKey
      ? 'ไม่พบ VITE_SUPABASE_ANON_KEY — ไปตั้งค่าที่ Vercel Project Settings > Environment Variables แล้ว Redeploy ใหม่'
      : null

// ใช้ placeholder ตอน config ไม่ครบ/ไม่ถูกต้อง เพื่อไม่ให้ createClient throw ตอน import
// จนทั้งแอพ render ไม่ขึ้นเลย (จอขาวสนิท ไม่มีแม้แต่ข้อความ error)
export const supabase = createClient(
  urlIsValid ? rawUrl! : 'https://placeholder.supabase.co',
  rawKey ?? 'placeholder',
)
