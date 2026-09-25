# IPD AR Discharge

ระบบติดตามเคสผู้ป่วยใน (IPD) — React + Vite + TypeScript + Tailwind v4, ต่อกับ Supabase โดยตรง (ไม่มี backend แยก), login ด้วย Google จำกัดเฉพาะ @mahidol.ac.th

## Stack

- Frontend: React 18 + Vite + TypeScript + Tailwind CSS v4
- Backend: Supabase (Postgres + Auth) — project "IPD AR discharge" (`qwivyyvhezqbhlukcsmt`)
- Auth: Google OAuth ผ่าน Supabase Auth, จำกัดโดเมนด้วย Postgres trigger + RLS
- Deploy: Vercel

## รันในเครื่อง (local dev)

```bash
npm install
npm run dev
```

ไฟล์ `.env` มีค่า `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` ของโปรเจกต์อยู่แล้ว (เป็น anon key แบบ public ปลอดภัยที่จะ commit ไม่ได้ แต่กันไว้ด้วย `.gitignore` อยู่ดี — ถ้าโคลนเครื่องใหม่ให้ copy จาก `.env.example`)

## Push ขึ้น GitHub ผ่าน GitHub Desktop

1. เปิด GitHub Desktop → File → Add Local Repository → เลือกโฟลเดอร์นี้
2. ถ้ายังไม่มี repo ปลายทาง ให้สร้าง repo ใหม่บน GitHub ก่อน แล้วค่อย publish จาก GitHub Desktop
3. Commit ทุกไฟล์ (ยกเว้น `node_modules`, `dist`, `.env` ที่ถูก ignore ไว้แล้ว) แล้ว push

## Deploy บน Vercel

1. Import repo นี้เป็น Vercel project ใหม่ (framework preset: Vite)
2. ตั้งค่า Environment Variables ใน Vercel project settings:
   - `VITE_SUPABASE_URL` = `https://qwivyyvhezqbhlukcsmt.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = (ค่าเดียวกับใน `.env`)
3. Deploy — Vercel จะ build ด้วย `npm run build` และ serve จาก `dist/` อัตโนมัติ
4. หลัง deploy ครั้งแรก ให้กลับไปที่ Supabase Dashboard → Authentication → URL Configuration → ตั้ง Site URL เป็นโดเมน Vercel ที่ได้ (และเพิ่มใน Redirect URLs ด้วยถ้าจำเป็น)

## สิทธิ์การใช้งาน

- ทุกคนที่ login ด้วยอีเมล @mahidol.ac.th เข้าดูข้อมูลได้ (read-only โดย default)
- ผู้ใช้ role `admin` เท่านั้นที่เพิ่ม/แก้ไขเคสได้ — ตั้ง role ได้โดยตรงในตาราง `app_users` ผ่าน Supabase SQL editor:
  ```sql
  update app_users set role = 'admin' where email = 'youremail@mahidol.ac.th';
  ```
  (ผู้ใช้ต้อง login เข้าระบบอย่างน้อย 1 ครั้งก่อน ถึงจะมีแถวใน `app_users` ให้แก้)

## สถานะเคลม (case_tracking)

1 แถวต่อ 1 encounter (ส่งเบิกได้ครั้งเดียวต่อเคสตามที่ตกลงกัน — ไม่มีประวัติหลายครั้ง):

- `document_received_date` — วันที่รับเอกสาร
- `audit_date`, `audit_amount` — วันที่ audit + ยอดเงิน
- `submission_date`, `submission_amount` — วันที่ส่งเบิก + ยอดเงิน

แก้ไขได้ 2 ทาง:
- **รายตัว** — กดปุ่ม "แก้ไข" ที่แถวเคสนั้น มีส่วน "สถานะเคลม" ในฟอร์ม
- **Bulk (CSV)** — ปุ่ม "อัพโหลดสถานะเคลม (CSV)" (เฉพาะ admin) เลือกขั้นตอน (รับเอกสาร/Audit/ส่งเบิก) แล้วอัพโหลดไฟล์ CSV รูปแบบ:
  ```
  encounter_id,audit_date,audit_amount
  3043836,2026-09-25,12500.50
  ```
  (คอลัมน์ตามขั้นตอนที่เลือก — ระบบ upsert ทับค่าเดิมด้วย encounter_id)

## โลโก้

ใช้โลโก้สถาบันการแพทย์จักรีนฤบดินทร์ (CNMI) จาก Wikimedia Commons แสดงผลด้วยเทคนิค CSS `mask-image` ให้เป็นสีทอง/เหลือง (`--color-amber` ใน `src/index.css`) โดยไม่ต้องแก้ไฟล์ภาพต้นฉบับ — ถ้าอยาก self-host แทนการโหลดจาก Wikimedia ดูวิธีใน comment ของ `src/components/BrandLogo.tsx`

## Export Excel

ปุ่ม "Export Excel" บน Dashboard (ใช้ได้ทุกสิทธิ์ ไม่จำกัด admin) ส่งออกเฉพาะรายการที่กรอง/ค้นหาอยู่ ณ ขณะนั้น เป็นไฟล์ `.xlsx` (ใช้ไลบรารี SheetJS ฝั่ง client ไม่ผ่าน server)

## ยังไม่ได้ทำ

- Storage bucket สำหรับแนบไฟล์เอกสาร/หลักฐาน (ตอนนี้เป็นแค่ CSV mapping ไม่มีการเก็บไฟล์ต้นฉบับ)
- หน้าจัดการสิทธิ์ผู้ใช้ (ตอนนี้ตั้ง role ผ่าน SQL / ตั้ง bootstrap admin ผ่าน trigger เท่านั้น)
