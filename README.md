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
- มี 3 role: `admin` (ทำได้ทุกอย่าง), `user` (ผู้ใช้ทั่วไป: ⬇ Export Excel, อัพโหลดสถานะเคลม (CSV), + เพิ่มเคส เท่านั้น — แก้ไขเคสเดิม/นำเข้าเคส CSV/รับเอกสาร/จัดการผู้ใช้ไม่ได้), `viewer` (ดูและ Export อย่างเดียว)
- `nattapoom.chu@mahidol.ac.th` ถูกตั้งเป็น admin อัตโนมัติตั้งแต่ login ครั้งแรก (bootstrap admin ผ่าน Postgres trigger)
- คนอื่นตั้ง role/หน่วยงานได้ผ่านหน้าเว็บ ปุ่ม "จัดการสิทธิ์ผู้ใช้" (admin เท่านั้นที่เห็นปุ่มนี้) — ผู้ใช้ต้อง login เข้าระบบอย่างน้อย 1 ครั้งก่อน ถึงจะมีชื่อให้เลือกตั้งสิทธิ์

## สถานะเคลม (case_tracking)

1 แถวต่อ 1 encounter (ส่งเบิกได้ครั้งเดียวต่อเคสตามที่ตกลงกัน — ไม่มีประวัติหลายครั้ง):

- `document_received_date` — วันที่รับเอกสาร
- `audit_date`, `audit_amount` — วันที่ audit + ยอดเงิน
- `submission_date`, `submission_amount`, `claim_no` — วันที่ส่งเบิก + ยอดเงิน + เลขที่ใบส่งเบิก

แก้ไขได้ 2 ทาง:
- **รายตัว** — กดปุ่ม "แก้ไข" ที่แถวเคสนั้น มีส่วน "สถานะเคลม" ในฟอร์ม
- **Bulk (CSV)** — ปุ่ม "อัพโหลดสถานะเคลม (CSV)" (admin และ user) เลือกขั้นตอน แล้วอัพโหลดไฟล์ CSV รูปแบบ:
  ```
  # รับเอกสาร
  encounter_id,document_received_date
  3043836,2026-09-24

  # audit — export จาก Google Sheet ที่ทีม audit ใช้อยู่เป็น CSV แล้วตัดคอลัมน์เหลือแค่ 2 คอลัมน์นี้พอ
  encounter_id,audit_date,audit_amount
  3043836,2026-09-25,12500.50

  # ส่งเบิก — ต้องมี payer_id ด้วย ระบบจะเช็คกับ payer ที่บันทึกไว้ของ encounter นั้น ถ้าไม่ตรงจะไม่บันทึกแถวนั้น (กันแมพผิดเคส)
  encounter_id,payer_id,claim_no,submission_date,submission_amount
  3043836,50257,CLM-2026-0912,2026-09-26,12500.50
  ```
  (ระบบ upsert ทับค่าเดิมด้วย encounter_id)

**เรื่อง audit จาก Google Sheet:** ตอนนี้ยังไม่ได้เชื่อมต่ออัตโนมัติ (ชีตที่ให้ลิงก์มาไม่ได้เปิดสาธารณะ ดึงตรงไม่ได้) — ให้ export ชีตนั้นเป็น CSV แล้วอัพผ่านฟีเจอร์ข้างบนไปก่อน ถ้าต้องการให้ระบบดึงอัตโนมัติในเฟสถัดไป แนวทางคือทำ Supabase Edge Function ที่ใช้ Google Service Account (แชร์สิทธิ์ viewer ให้ service account บนชีตนั้น) อ่านผ่าน Sheets API v4 แล้ว upsert เข้า `case_tracking` ให้เอง — ยังไม่ได้ทำเพราะต้องตั้งค่า Google Cloud service account เพิ่ม

## นำเข้าเคสใหม่จาก HIS (CSV)

ปุ่ม "นำเข้าเคสใหม่ (CSV)" (เฉพาะ admin) — อัพโหลดไฟล์รูปแบบเดียวกับไฟล์ตั้งต้น (คอลัมน์: HN, AN, encounter_id, name, admit_date, admited_time, discharge_date, discharge_time, division_code, status, Los, birthdate, coverage_code, coverage_name, payer_id, payer_name) ระบบจะ upsert เข้า `patients`/`admissions`/`coverage_master`/`payer_master` ให้เอง encounter_id ที่มีอยู่แล้วจะถูกอัพเดตทับ ไม่สร้างซ้ำ — ยังไม่มีการเชื่อมต่อ API กับ HIS โดยตรง (ตามที่ตกลงว่ายังเป็นโปรเจกต์ทดลอง ใช้ไฟล์อัพโหลดจาก admin ไปก่อน)

## จัดการสิทธิ์ผู้ใช้

ปุ่ม "จัดการผู้ใช้" บน navbar ข้างชื่อที่ login (เฉพาะ admin) — ดูรายชื่อคนที่เคย login เข้าระบบ ตั้ง role (admin/user/viewer) และ "หน่วยงาน" (รองรับกรณีทีมมาจากหลายหน่วยงาน) ได้จากหน้าเว็บโดยตรง ไม่ต้องรัน SQL

## โลโก้

ใช้โลโก้สถาบันการแพทย์จักรีนฤบดินทร์ (CNMI) จาก Wikimedia Commons แสดงผลด้วยเทคนิค CSS `mask-image` ให้เป็นสีทอง/เหลือง (`--color-amber` ใน `src/index.css`) โดยไม่ต้องแก้ไฟล์ภาพต้นฉบับ — ถ้าอยาก self-host แทนการโหลดจาก Wikimedia ดูวิธีใน comment ของ `src/components/BrandLogo.tsx`

## Export Excel

ปุ่ม "Export Excel" บน Dashboard (ใช้ได้ทุกสิทธิ์ ไม่จำกัด admin) ส่งออกเฉพาะรายการที่กรอง/ค้นหาอยู่ ณ ขณะนั้น เป็นไฟล์ `.xlsx` (ใช้ไลบรารี SheetJS ฝั่ง client ไม่ผ่าน server)

## แก้ปัญหา "deploy แล้วจอขาว"

ถ้าเปิดเว็บแล้วจอขาวสนิท (ไม่มีแม้แต่ข้อความ error) สาเหตุที่พบบ่อยที่สุดคือค่า `VITE_SUPABASE_URL` ที่วางใน Vercel มีอักขระเกิน (เว้นวรรค/เครื่องหมายคำพูดติดมาตอน copy-paste) โค้ดเวอร์ชันนี้ป้องกันไว้แล้ว (จะขึ้นข้อความ "ตั้งค่าระบบไม่ครบ" แทนจอขาว) แต่ env var ชนิด "sensitive" ใน Vercel **เปิดดูค่าเดิมซ้ำไม่ได้เลย** ถ้าไม่แน่ใจว่าค่าที่วางไว้ถูกต้อง ให้ลบตัวเดิมทิ้งแล้ววางใหม่จาก `.env.example` ให้ตรงเป๊ะ (Settings > Environment Variables) แล้ว Redeploy

## ยังไม่ได้ทำ

- Storage bucket สำหรับแนบไฟล์เอกสาร/หลักฐาน (ตอนนี้เป็นแค่ CSV mapping ไม่มีการเก็บไฟล์ต้นฉบับ)
- ดึงข้อมูล audit จาก Google Sheet อัตโนมัติ (ตอนนี้ต้อง export เป็น CSV เอง — ดูหัวข้อด้านบน)
