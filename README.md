# IPD AR Discharge

ระบบติดตามเคสผู้ป่วยใน (IPD) — React + Vite + TypeScript + Tailwind v4, ต่อกับ Supabase โดยตรง (ไม่มี backend แยก), login ด้วย Google จำกัดเฉพาะ @mahidol.ac.th

## Stack

- Frontend: React 18 + Vite + TypeScript + Tailwind CSS v4
- Backend: Supabase (Postgres + Auth) — project "IPD AR discharge" (`qwivyyvhezqbhlukcsmt`)
- Auth: Google OAuth ผ่าน Supabase Auth, จำกัดโดเมนด้วย Postgres trigger (`handle_new_user`) + RLS
- Deploy: Vercel (project `ipd`, repo `poom9417/IPD`, branch `main` → production อัตโนมัติ)

## รันในเครื่อง (local dev)

```bash
npm install
npm run dev
```

ถ้าโคลนเครื่องใหม่ให้ copy `.env.example` เป็น `.env` (ค่า `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`) — anon key เป็น public key ตามการออกแบบของ Supabase ความปลอดภัยจริงอยู่ที่ RLS ฝั่งฐานข้อมูล แต่ `.env` ก็ถูกกันไว้ใน `.gitignore` อยู่แล้ว

## Push ขึ้น GitHub ผ่าน GitHub Desktop

1. เปิด GitHub Desktop → File → Add Local Repository → เลือกโฟลเดอร์นี้
2. Commit ทุกไฟล์ (ยกเว้น `node_modules`, `dist`, `.env` ที่ถูก ignore ไว้แล้ว) แล้ว Push ไปที่ `main`
3. Vercel จะ build และ deploy ให้อัตโนมัติ (ดูสถานะที่ Vercel → project `ipd` → Deployments)

## Deploy บน Vercel (ตั้งค่าครั้งแรก)

1. Import repo นี้เป็น Vercel project ใหม่ (framework preset: Vite)
2. ตั้งค่า Environment Variables ใน Vercel project settings:
   - `VITE_SUPABASE_URL` = `https://qwivyyvhezqbhlukcsmt.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = (ค่าเดียวกับใน `.env`)
3. Deploy — Vercel จะ build ด้วย `npm run build` และ serve จาก `dist/` อัตโนมัติ
4. กลับไปที่ Supabase Dashboard → Authentication → URL Configuration → ตั้ง Site URL เป็นโดเมน Vercel (และเพิ่มใน Redirect URLs ถ้าจำเป็น)

## สิทธิ์การใช้งาน (4 role)

ทุกคนที่ login ด้วย @mahidol.ac.th จะถูกสร้างเป็น `viewer` อัตโนมัติ แล้ว admin ค่อยปรับ role ให้

| ความสามารถ | admin | user | audit | viewer |
|---|:-:|:-:|:-:|:-:|
| ดูข้อมูล / Export Excel | ✅ | ✅ | ✅ | ✅ |
| + เพิ่มเคส | ✅ | ✅ | – | – |
| แก้ไขเคสเดิม / นำเข้าเคส (CSV) / ปุ่ม "รับเอกสาร" | ✅ | – | – | – |
| อัพโหลดสถานะเคลม (CSV) | ทุกขั้นตอน | ทุกขั้นตอน | **เฉพาะขั้น Audit** | – |
| กดปุ่ม "Audit" (บันทึกวัน Audit = วันนี้) | ✅ | – | ✅ | – |
| Code C: แจ้งเคสติด C / แก้สาเหตุ | ✅ | ✅ (เฉพาะรายการของตัวเอง ก่อน audit ตอบ) | – | – |
| Code C: ตอบ "แก้ไขอย่างไร" | ✅ | – | ✅ | – |
| Code C: ลบรายการ | ✅ | – | – | – |
| หน้า My job (เลือกสิทธิที่ดูแล) | ✅ | ✅ | **ไม่มีหน้านี้** | – |
| จัดการผู้ใช้ (ตั้ง role / หน่วยงาน) | ✅ | – | – | – |

- **audit** มีหน้าที่แค่ลงวัน Audit และตอบ Code C — ฐานข้อมูลบังคับซ้ำอีกชั้น (trigger `guard_case_tracking_audit`) ว่า audit แก้ได้เฉพาะ `audit_date`
- `nattapoom.chu@mahidol.ac.th` ถูกตั้งเป็น admin อัตโนมัติตั้งแต่ login ครั้งแรก (bootstrap admin ผ่าน Postgres trigger)
- ตั้ง role/หน่วยงานได้ที่ปุ่ม "จัดการผู้ใช้" (เฉพาะ admin) — ผู้ใช้ต้อง login อย่างน้อย 1 ครั้งก่อนถึงจะมีชื่อในรายการ

## หน้าในระบบ

- **Mine** — รายการเคสทั้งหมด กรองตามหอผู้ป่วย / สถานะเคลม / ผู้จ่าย / สิทธิ (เลือกได้หลายอัน) / ช่วงวันจำหน่าย, Export Excel, อัพโหลด CSV, ปุ่ม "เฉพาะสิทธิของฉัน"
- **Code C** — เคสที่ส่งเบิกแล้วแต่ติด C: user แจ้งสาเหตุ + dateline → audit ตอบว่าแก้ไขอย่างไร ระบบประทับชื่อ/เวลาของทั้งสองฝั่งให้ (client แก้เวลาเองไม่ได้) เลือกแจ้งได้เฉพาะเคสที่มี `submission_date` แล้ว
- **My job** — เลือกสิทธิการรักษาที่ตัวเองรับผิดชอบ (admin / user เท่านั้น)

### My job: 1 สิทธิ = 1 ผู้ดูแล

- 1 คนดูแลได้หลายสิทธิ แต่ **1 สิทธิมีผู้ดูแลได้คนเดียว** (`coverage_assignments` มี primary key = `coverage_code`)
- สิทธิที่มีคนดูแลแล้วจะเลือกไม่ได้ (แสดงอีเมลเจ้าของ) ถ้ากดบันทึกตัดหน้ากัน ฐานข้อมูลจะไม่บันทึกสิทธิที่ซ้ำและหน้าเว็บแจ้งรายการนั้นให้ทราบ
- ถ้าผู้ดูแลลาออก/ย้ายงาน ให้ admin ลบแถวใน `coverage_assignments` ของสิทธินั้นก่อน คนใหม่จึงจะเลือกได้
- บันทึกแล้วหน้า Mine และ Code C จะมีปุ่ม "เฉพาะสิทธิของฉัน" ให้กรองเคส

## สถานะเคลม (case_tracking)

**1 แถวต่อ 1 แถวสิทธิ/ผู้จ่าย** (คีย์คือ `admission_id`) — encounter ที่แยกหลายสิทธิจึงมีสถานะเคลมแยกกัน ส่งเบิกได้ครั้งเดียวต่อแถว (ไม่มีประวัติหลายครั้ง)

- `document_received_date`, `document_received_amount` — วันที่รับเอกสาร + ยอดรับเอกสาร (ลงโดย admin / user)
- `audit_date` — วันที่ audit (ไม่มียอดเงิน; ลงโดย admin / audit)
- `submission_date`, `submission_amount`, `claim_no` — วันที่ส่งเบิก + ยอดเงิน + เลขที่ใบส่งเบิก

ขั้นตอนเคลม (ใช้กรองในหน้า Mine): รอรับเอกสาร → รอ Audit → รอส่งเบิก → ส่งเบิกแล้ว

แก้ไขได้ 3 ทาง:
- **ปุ่มลัดในตาราง** — "รับเอกสาร" (admin, user) กดแล้วกรอกยอดรับเอกสาร ยืนยันด้วย ✓ / Enter แล้วบันทึกวันนี้พร้อมยอด · "Audit" (admin, audit) กดแล้วบันทึกวันนี้ทันที
- **รายตัว** — admin กดปุ่ม "แก้ไข" ที่แถวเคส มีส่วน "สถานะเคลม" ในฟอร์ม
- **Bulk (CSV)** — ปุ่ม "อัพโหลดสถานะเคลม (CSV)" เลือกขั้นตอน แล้วอัพโหลดไฟล์รูปแบบ:
  ```
  # รับเอกสาร — ต้องมียอดรับเอกสารทุกแถว
  encounter_id,document_received_date,document_received_amount
  3043836,2026-09-24,12500.50

  # audit — export จาก Google Sheet ของทีม audit เป็น CSV แล้วเหลือคอลัมน์เหล่านี้
  encounter_id,audit_date
  3043836,2026-09-25

  # ส่งเบิก — ต้องมี payer_id ระบบจะเช็คกับ payer ของ encounter นั้น ถ้าไม่ตรงจะไม่บันทึกแถวนั้น (กันแมพผิดเคส)
  encounter_id,payer_id,claim_no,submission_date,submission_amount
  3043836,50257,CLM-2026-0912,2026-09-26,12500.50
  ```
  - ขั้นรับเอกสาร/Audit: ถ้า encounter แยกหลายสิทธิ และไม่ใส่ `payer_id` จะลงทุกสิทธิของ encounter นั้น (ใส่ `payer_id` เพื่อระบุแถวเดียวได้)
  - ขั้นส่งเบิก: ถ้า encounter แยกหลายสิทธิ **ต้องระบุ** `payer_id`
  - ระบบ upsert ทับค่าเดิมด้วย `admission_id`
  - role audit เลือกได้เฉพาะขั้น Audit

**เรื่อง audit จาก Google Sheet:** ยังไม่ได้เชื่อมอัตโนมัติ (ชีตไม่ได้เปิดสาธารณะ) — ให้ export เป็น CSV แล้วอัพผ่านฟีเจอร์ข้างบน ถ้าต้องการอัตโนมัติ แนวทางคือทำ Supabase Edge Function ที่ใช้ Google Service Account (แชร์สิทธิ์ viewer บนชีต) อ่านผ่าน Sheets API v4 แล้ว upsert เข้า `case_tracking`

## นำเข้าเคสใหม่จาก HIS (CSV)

ปุ่ม "นำเข้าเคสใหม่ (CSV)" (เฉพาะ admin) — อัพโหลดไฟล์รูปแบบเดียวกับไฟล์ตั้งต้น (คอลัมน์: HN, AN, encounter_id, name, admit_date, admited_time, discharge_date, discharge_time, division_code, status, Los, birthdate, coverage_code, coverage_name, payer_id, payer_name)

ทำงานในฟังก์ชันฐานข้อมูล `import_admissions` รอบเดียว (transaction เดียว):
- 1 แถว = 1 encounter ต่อ 1 สิทธิ/ผู้จ่าย — แถวที่ encounter + สิทธิ + ผู้จ่ายตรงกับที่มีอยู่จะถูกอัพเดตทับ ไม่สร้างซ้ำ
- เพิ่ม HN / สิทธิ / ผู้จ่ายใหม่ให้อัตโนมัติ, ค่า NULL ของสิทธิ/ผู้จ่ายบันทึกเป็น `UNK`
- แถว `UNK` จะถูกข้ามถ้า encounter นั้นมีสิทธิจริงอยู่แล้ว และแถว `UNK` เดิมจะถูกเปลี่ยนเป็นสิทธิจริงเมื่อไฟล์ใหม่มีข้อมูล (สถานะเคลมเดิมไม่หาย)
- ยังไม่มีการเชื่อม API กับ HIS โดยตรง (โปรเจกต์ทดลอง ใช้ไฟล์อัพโหลดจาก admin ไปก่อน)

## Export Excel

ปุ่ม "Export Excel" บน Mine (ทุก role) ส่งออกเฉพาะรายการที่กรอง/ค้นหาอยู่ ณ ขณะนั้นเป็นไฟล์ `.xlsx` (SheetJS ฝั่ง client) คอลัมน์รวมสถานะเคลมทั้งหมด: วัน/ยอดรับเอกสาร, วัน Audit, วัน/ยอดส่งเบิก และ `claim_no`

## ธีมและโลโก้

ธีมเหลือง / ขาว / ดำ กำหนดเป็น CSS variable ใน `src/index.css` (`--color-brand`, `--color-ink`, `--color-paper` ฯลฯ)

โลโก้สถาบันการแพทย์จักรีนฤบดินทร์ (CNMI) จาก Wikimedia Commons แสดงเป็นสีทอง/เหลือง (`--color-brand`) ด้วย CSS `mask-image` โดยไม่ต้องแก้ไฟล์ภาพ — ถ้าอยาก self-host ดูวิธีใน comment ของ `src/components/BrandLogo.tsx`

## ฐานข้อมูล (Supabase)

ไฟล์ SQL ใน `supabase/` — เก็บไว้เป็นบันทึกและใช้ตั้ง environment ใหม่ (production รันครบแล้ว) รันตามลำดับ:

1. `add_user_role.sql` — role `user` + ฟังก์ชัน `is_editor()`
2. `add_audit_codec_myjob.sql` — role `audit`, ตาราง Code C, ตาราง My job (1 สิทธิ = 1 ผู้ดูแล)
3. `harden_function_privileges.sql` — ปิดสิทธิ์ `anon` ที่ไม่จำเป็นบนฟังก์ชัน SECURITY DEFINER (มี rollback อยู่ท้ายไฟล์)

หมายเหตุด้านความปลอดภัย: Security Advisor ของ Supabase ยังเตือน `import_admissions`, `is_admin`, `is_editor`, `my_role`, `my_email` ว่า "signed-in users เรียกได้" — **ตั้งใจเก็บไว้** เพราะ RLS policy เรียกใช้ฟังก์ชันเหล่านี้ในนามผู้ใช้ที่ login (ถ้าถอนสิทธิ์ policy ทั้งหมดจะพัง) และ `import_admissions` เช็ค `is_admin()` ภายในฟังก์ชันอยู่แล้ว ส่วนเตือน "Leaked Password Protection" ไม่เกี่ยวข้อง เพราะระบบใช้ Google OAuth อย่างเดียว ไม่มี password

## แก้ปัญหา "deploy แล้วจอขาว"

ถ้าเปิดเว็บแล้วจอขาวสนิท สาเหตุที่พบบ่อยที่สุดคือค่า `VITE_SUPABASE_URL` ที่วางใน Vercel มีอักขระเกิน (เว้นวรรค/เครื่องหมายคำพูดติดมาตอน copy-paste) โค้ดเวอร์ชันนี้ป้องกันไว้แล้ว (จะขึ้นข้อความ "ตั้งค่าระบบไม่ครบ" แทนจอขาว) แต่ env var ชนิด "sensitive" ใน Vercel **เปิดดูค่าเดิมซ้ำไม่ได้** ถ้าไม่แน่ใจว่าค่าถูกต้อง ให้ลบแล้ววางใหม่จาก `.env.example` ให้ตรงเป๊ะ (Settings > Environment Variables) แล้ว Redeploy

## ยังไม่ได้ทำ

- Storage bucket สำหรับแนบไฟล์เอกสาร/หลักฐาน (ตอนนี้เป็นแค่ CSV mapping ไม่มีการเก็บไฟล์ต้นฉบับ)
- ดึงข้อมูล audit จาก Google Sheet อัตโนมัติ (ดูหัวข้อ "สถานะเคลม")
- ปุ่มให้ admin ปลดผู้ดูแลสิทธิในหน้า My job (ตอนนี้ต้องลบแถวใน `coverage_assignments` เอง)
