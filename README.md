# IPD AR Discharge

ระบบเก็บข้อมูลผู้ป่วยใน (IPD) และติดตามสถานะเคลม ตั้งแต่รับเอกสาร → Audit → ส่งเบิก รวมถึงเคสที่ติด Code C หลังส่งเบิก

- เว็บ: https://ipd-pi-woad.vercel.app
- Login ด้วย Google เท่านั้น จำกัดโดเมน `@mahidol.ac.th` และต้องได้รับอนุมัติจาก developer ก่อนจึงใช้งานได้
- นำเข้าข้อมูลเคสโดย admin อัพโหลดไฟล์ (ยังไม่มีการเชื่อม HIS API) — โปรเจกต์ทดลอง รูปแบบไฟล์คงที่

## Stack

| ส่วน | เทคโนโลยี |
|---|---|
| Frontend | React 18 + Vite 5 + TypeScript + Tailwind CSS v4 |
| Backend / DB | Supabase (Postgres + Auth + RLS + Edge Functions) — ไม่มี backend แยก |
| Auth | Google OAuth ผ่าน Supabase Auth, ตรวจโดเมนที่ฝั่ง DB ด้วย trigger `handle_new_user` |
| Hosting | Vercel (project `ipd`) — push เข้า `main` แล้ว build/deploy อัตโนมัติ |
| ไลบรารีหลัก | `exceljs` (Export Excel) · `xlsx` (อ่านไฟล์ `.xls` ของระบบเบิก GGO) · `papaparse` (CSV) |
| ธีม | เหลือง / ขาว / ดำ — กำหนดเป็น CSS variable ใน `src/index.css` (โลโก้ CNMI แสดงสีทองด้วย CSS mask ใน `BrandLogo.tsx`) |

## รันในเครื่อง

ต้องใช้ Node.js 18 ขึ้นไป

```bash
npm install
cp .env.example .env     # ค่า VITE_SUPABASE_URL และ VITE_SUPABASE_ANON_KEY
npm run dev
npm run build            # tsc + vite build (ต้องผ่านก่อน push ทุกครั้ง)
```

anon key เป็น public key ตามการออกแบบของ Supabase ความปลอดภัยจริงอยู่ที่ RLS และฟังก์ชันฝั่งฐานข้อมูล

## Deploy

Push ขึ้น `main` ที่ GitHub แล้ว Vercel จะ build ให้เอง (framework: Vite, build ด้วย `npm run build`, serve จาก `dist/`)

ตั้งค่าครั้งแรก:

1. Vercel → Settings → Environment Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   - **วางเป็นข้อความธรรมดาเท่านั้น** ห้ามมีเครื่องหมายคำพูด เว้นวรรค หรือวงเล็บ markdown แบบ `[url](url)` (เคยทำให้หน้าจอขาว)
   - ตั้งค่าแล้วต้อง **Redeploy** ใหม่ ค่าจึงมีผล
2. Supabase → Authentication → URL Configuration: ตั้ง Site URL และ Redirect URLs เป็นโดเมนของ Vercel
3. Supabase → Authentication → Providers: เปิดเฉพาะ Google (ปิด Email provider)

`vercel.json` ตั้ง security headers ไว้ (CSP, HSTS, X-Frame-Options ฯลฯ) — ถ้าเปลี่ยนโดเมน Supabase ต้องแก้ `connect-src` ใน CSP ด้วย

## Role และสิทธิ์การใช้งาน

ผู้ที่ login ครั้งแรกจะเป็น `viewer` สถานะ **รออนุมัติ** เห็นแค่หน้ารอ จน **developer** อนุมัติและกำหนด role ให้ (ผู้ใช้เดิมก่อนมีระบบนี้ถือว่าอนุมัติแล้ว) สถานะอนุมัติอ่านไม่ได้เมื่อไรระบบถือว่า "ยังไม่อนุมัติ" (fail-closed)

| ความสามารถ | developer | admin | user | audit | viewer |
|---|:-:|:-:|:-:|:-:|:-:|
| ดูรายการเคส | ✅ | ✅ | ✅ | ✅ | ✅ |
| Export Excel | ✅ | ✅ | ✅ | ✅ (7 คอลัมน์) | – |
| + เพิ่มเคส | ✅ | ✅ | ✅ | – | – |
| แก้ไข / ลบเคส | ✅ | ✅ | – | – | – |
| ปุ่ม "รับเอกสาร" แก้ยอด/วันที่รับเอกสาร | ✅ | ✅ | ✅ | – | – |
| อัพโหลดสถานะเคลม (bulk) | ทุกขั้น | ทุกขั้น | รับเอกสาร / ส่งเบิก | – | – |
| บันทึกวัน Audit (ปุ่ม / bulk / ดึงจาก Sheet) | ✅ | ✅ | – | – | – |
| นำเข้าเคสใหม่ (CSV) | ✅ | ✅ | – | – | – |
| ส่ง/ดึงข้อมูล Google Sheet | ✅ | ✅ | – | – | – |
| หน้า Dashboard สรุปลูกหนี้ | ✅ | ✅ | ✅ | – | ✅ |
| Code C: แจ้งรหัสที่ติด C | ✅ | ✅ | ✅ | – | – |
| Code C: ตอบวิธีแก้ | ✅ | ✅ | – | ✅ | – |
| Code C: กด "ผ่าน / ไม่ผ่านการแก้ C" | จำลองเป็น user | – | ✅ | – | – |
| Code C: แก้ / ลบแถวรหัส | ✅ | ✅ | – | – | – |
| My job (Dashboard + My claim) | เฉพาะ My claim | ✅ | ✅ | – | – |
| เลือกสิทธิให้ผู้อื่น | ✅ | – | – | – | – |
| อนุมัติผู้ใช้ / กำหนด role / จัดการหน่วยงาน | ✅ | – | – | – | – |
| จำลองมุมมอง role อื่น | ✅ | – | – | – | – |

หมายเหตุ

- **developer** = สิทธิ์ admin + จำลองมุมมองแต่ละ role ได้จากเมนู "จำลองเป็น" (จำลองฝั่งหน้าจอเท่านั้น ไม่เปลี่ยน role จริง) admin เห็นบัญชี developer ในรายชื่อแต่แก้ไม่ได้
- **audit** บันทึกวัน Audit ผ่านหน้าเว็บไม่ได้ วัน Audit เข้าระบบทางเดียวคือ admin / developer กด "ดึง Audit จาก Sheet" (ดูหัวข้อ Google Sheet)
- ข้อมูลที่เห็นขึ้นกับ role และบังคับที่ฐานข้อมูล ไม่ใช่แค่ซ่อนที่หน้าจอ: audit ไม่เห็นยอดเงิน · viewer เห็นยอดแต่ไม่เห็นชื่อผู้ป่วยและวันเกิด · วันเกิดเห็นเฉพาะ developer / admin (อ่านผ่าน view `patients_v` / `case_tracking_v` และเขียนผ่าน RPC `save_patient` / `upsert_case_tracking`)
- ผู้ใช้ใหม่เห็นทัวร์แนะนำการใช้งานตาม role ครั้งแรกที่เข้า และเปิดดูซ้ำได้ที่ปุ่ม "คู่มือใช้งาน" บน navbar

## หน้าในระบบ

เมนู (ปุ่ม Menu บน navbar) มี 3 กลุ่ม

### หน้าหลัก (Main / Dashboard)

สลับโหมดได้ที่ปุ่ม Main / Dashboard

- **Main** — รายการเคสแบบแบ่งหน้า เรียงวันจำหน่ายใหม่สุดก่อน (ค้นหา/กรอง/นับสรุปทำที่ฐานข้อมูลผ่าน `search_admissions`) กรองตามคำค้น (HN / ชื่อ / encounter_id / AN) หอผู้ป่วย ผู้จ่าย สิทธิ (เลือกได้หลายอัน) ช่วงวันจำหน่าย (เลือกวันเดียวได้) ขั้นตอนเคลม และ "เฉพาะสิทธิของฉัน" คลิกเคสเพื่อดูรายละเอียด (read-only สำหรับ role ที่แก้ไม่ได้)
- **Dashboard** — สรุปลูกหนี้ IPD ค้างส่งเบิกรวมทุกสิทธิ ณ วันที่เลือก แบ่งตามกลุ่มสิทธิ แสดงจำนวนราย/เงิน ตามช่วงอายุ (ภายใน 20 / 21–30 / 31–90 / เกิน 90 วัน) รวมเกินกำหนด และ % คงค้าง การจัดกลุ่มสิทธิแก้ที่ `src/lib/arSummary.ts` (กลุ่ม PRI คือกลุ่มรับส่วนที่เหลือ ไม่รวมสิทธิ `UNK`) ซ่อนจาก role audit

### Code C

เคสที่ส่งเบิกแล้วแต่ติด C — 1 เคสมีได้หลายรหัส จัดการทีละแถวรหัส

1. user / admin แจ้งแถวรหัส: ชนิด (โรค / อุปกรณ์) · รหัส · สาเหตุที่ติด C แล้วกดยืนยันครั้งเดียว
2. audit ตอบวิธีแก้ทีละรหัส — เมื่อตอบแล้วถือว่า "ผ่านโดยปริยาย" และ user ที่แจ้งจะได้รับ popup แจ้งเตือนมุมขวาบน
3. user กด "ผ่านการแก้ C" เพื่อปิดแถว หรือ "ไม่ผ่านการแก้ C" (มี dialog ยืนยัน) เพื่อส่งกลับให้ audit แก้รอบใหม่ โดยแสดงคำตอบรอบก่อนให้เห็น
4. Dateline = วันที่ส่งเบิก + 7 วัน คำนวณสดทุกครั้ง หยุดนับเมื่อ audit ตอบ และนับต่อ (ไม่รีเซ็ต) เมื่อถูกกด "ไม่ผ่านการแก้ C"

ระบบเก็บประวัติรายรอบพร้อมผู้ทำและเวลา (ประทับเวลาที่ฝั่ง DB)

### My job

- **My claim** — เลือก "สิทธิ + ผู้จ่าย" (`coverage_code + payer_id`) ที่ตัวเองรับผิดชอบ ข้อกำหนด: 1 หน่วยมีผู้ดูแลได้คนเดียว (exclusive) · เลือกแล้ว **เอาออกเองไม่ได้** · developer เลือกสิทธิให้ผู้อื่นได้ ผู้รับต้องกดยืนยันที่แบนเนอร์ในหน้าหลัก (ตาราง `assignment_requests`: รอ → ยอมรับ / ปฏิเสธ / ยกเลิก)
- **Dashboard** — ระยะเวลาส่งเบิกของเคสที่ฉันดูแล เป็นกราฟและรายเคส เลือกจุดเริ่มนับได้ (จำหน่าย / รับเอกสาร / Audit → ส่งเบิก)

## ข้อมูลและสถานะเคลม

ตารางหลัก: `patients`, `admissions`, `coverage_master`, `payer_master`, `division_master`, `case_tracking`, `app_users`, `coverage_assignments`, `assignment_requests`, `code_c_cases`, `code_c_items`, `code_c_history`, `sheet_sync_state`

- **`admissions`**: คีย์คือ `admission_id` (1 แถว = encounter × coverage × payer) เพราะ encounter เดียวแยกได้หลายสิทธิ — `encounter_id` จึงไม่ใช่ PK เดี่ยว และ `AN` ไม่ unique
- สิทธิ/ผู้จ่ายที่ว่างหรือ `NULL` เก็บเป็น `UNK` (ไม่เบิก เก็บไว้อ้างอิง ผู้ใช้ปรับสิทธิทีหลัง) — แถว `UNK` เดิมจะถูกแทนด้วยสิทธิจริงเมื่อไฟล์ใหม่มีข้อมูล โดยสถานะเคลมไม่หาย
- **`case_tracking`**: 1 แถวต่อ `admission_id`, 1 เคส = ส่งเบิกครั้งเดียว (ไม่เก็บประวัติส่งซ้ำ) เก็บผู้แก้ไขล่าสุดเท่านั้น (ไม่มี audit log หลายแถว)
  `document_received_date/amount` · `audit_date` · `submission_date/amount` · `claim_no`

ขั้นตอนเคลม (ใช้กรอง): **รอรับเอกสาร → รอ Audit → รอส่งเบิก → ส่งเบิกแล้ว**
"ค้างเบิก (วัน)" = วันที่จำหน่าย → วันที่ส่งเบิก

### นำเข้าเคสใหม่ (admin)

ปุ่ม "นำเข้าเคสใหม่ (CSV)" ไฟล์รูปแบบเดียวกับไฟล์ HIS ตั้งต้น คอลัมน์: `HN, AN, encounter_id, name, admit_date, admited_time, discharge_date, discharge_time, division_code, status, Los, birthdate, coverage_code, coverage_name, payer_id, payer_name`

ทำงานผ่านฟังก์ชัน DB `import_admissions(rows jsonb)` ใน transaction เดียว: เพิ่ม HN / สิทธิ / ผู้จ่ายใหม่อัตโนมัติ, แถวที่ encounter + สิทธิ + ผู้จ่ายตรงกับที่มีอยู่จะอัพเดตทับ ไม่สร้างซ้ำ

### อัพโหลดสถานะเคลม (bulk)

เลือกขั้นตอนก่อนอัพโหลด

| ขั้นตอน | ไฟล์ | หมายเหตุ |
|---|---|---|
| รับเอกสาร | CSV: `encounter_id, document_received_date, document_received_amount` | ต้องมียอดทุกแถว |
| Audit | CSV: `encounter_id, audit_date` | ใช้แค่ `encounter_id` |
| ส่งเบิก | ไฟล์ `.xls` ของระบบเบิก GGO ใช้ได้เลยไม่ต้องแก้ | แมพ `enc_id→encounter_id`, `payer→payer_id`, `claim_no`, `dateclaim→submission_date` (แปลง พ.ศ. → ค.ศ.), `claim_amount→submission_amount`; แถวที่ `claimcancel` มี "X" ไม่นับ |

- ถ้า encounter แยกหลายสิทธิ ให้ใส่ `payer_id` เพื่อระบุแถว (ขั้นส่งเบิกจะเช็ค payer ให้ตรงเสมอ)
- ถ้าเคสมีค่าอยู่แล้ว จะแสดงใน preview และให้เลือก **ข้าม / เขียนทับ**

### Export Excel

ส่งออกเฉพาะชีต `IPD AR Discharge` ตามตัวกรองบนหน้าจอ (ไม่กรอง = ทั้งหมด) สร้างด้วย ExcelJS role audit ได้ 7 คอลัมน์: HN, AN, encounter_id, ชื่อผู้ป่วย, coverage_code, payer_id, วันที่จำหน่าย

## Google Sheet sync

ซิงก์กับชีตทะเบียนคุมของทีม Audit ผ่าน Supabase Edge Functions (เฉพาะ admin / developer)

- **`push-to-sheet`** — ส่งเคสไปวางทับทั้งแท็บ `ทะเบียนคุมเอกสารสิทธิ 70` (คงแถวหัว วางใหม่ทุกครั้ง ระบบเป็นต้นฉบับ ชีตเป็นสำเนา) กดปุ่ม "ส่งไป Google Sheet" เองได้ และระบบส่งให้อัตโนมัติหลัง admin นำเข้าเคสหรือบันทึกการแก้เคส (ถ้า Google ขัดข้อง การบันทึกในระบบยังสำเร็จตามปกติ) ส่งเฉพาะเคสที่จำหน่ายตั้งแต่ 2026-10-01 และไม่ส่งสิทธิ `UNK` / `DIS*` (ปรับเงื่อนไขที่ `MIN_DISCHARGE_DATE` ในฟังก์ชัน)
- **`pull-from-sheet`** — อ่านวัน Audit จากแท็บ `AUDIT_VIEW` (IMPORTRANGE จากชีต Audit) ตรวจเทียบฐานข้อมูล แสดงเป็น preview ให้ยืนยันก่อนบันทึก ฟังก์ชันนี้ไม่เขียนฐานข้อมูลเอง

ตั้งค่า: เปิด Google Sheets API ให้ Service Account, แชร์ชีตให้เป็น Editor, ตั้ง secret `GOOGLE_SA_JSON` และ `SHEET_ID` ใน Supabase (Edge Function secrets) — ห้ามนำ key เหล่านี้ใส่ใน repo

## ฐานข้อมูล (Supabase)

โฟลเดอร์ `supabase/` เก็บ SQL และ Edge Functions ไว้เป็นบันทึก/ใช้ตั้ง environment ใหม่ สถานะจริงของ production อยู่ที่ Supabase (บาง migration รันที่ Supabase โดยตรง จึงไม่ได้มีครบทุกไฟล์ในนี้ — ดูรายการจริงที่ `list_migrations` / Dashboard)

| ไฟล์ | เนื้อหา |
|---|---|
| `add_user_role.sql`, `add_audit_codec_myjob.sql`, `add_developer_role.sql` | role และฟังก์ชัน `is_admin()` / `is_editor()` / `is_developer()`, Code C, My job |
| `restrict_audit_role.sql`, `restrict_user_audit_fields.sql` | จำกัดสิทธิ์ audit / user ที่ระดับ DB (trigger `guard_case_tracking_audit`) |
| `add_search_admissions.sql` | `search_admissions` สำหรับแบ่งหน้า/ค้นหา/สรุปตัวเลข |
| `add_master_growth.sql` | `division_master` และการเพิ่มสิทธิ/ผู้จ่าย/หอผู้ป่วยใหม่ |
| `code_c_items_pass_status.sql` | Code C รายแถวรหัส + สถานะ "ผ่านแล้ว" |
| `add_user_approval.sql`, `20261021_restrict_user_approval*.sql` | ระบบอนุมัติผู้ใช้ (มีไฟล์ TEST และ rollback) |
| `add_sheet_sync.sql` | ตาราง `sheet_sync_state` |
| `harden_function_privileges.sql` | ปิดสิทธิ์ `anon` บนฟังก์ชัน SECURITY DEFINER |
| `functions/push-to-sheet`, `functions/pull-from-sheet` | Edge Functions (แต่ละตัวมี `common.ts` / `google.ts` ของตัวเอง — แก้แล้วต้องอัพเดตทั้งสองโฟลเดอร์ให้ตรงกัน) |

กติกาที่ต้องรักษา

- policy ที่เช็ค role ให้เรียก `public.is_admin()` / `is_editor()` (SECURITY DEFINER) **ห้ามใช้ subquery ย้อนไป `app_users` ใน policy ของ `app_users` เอง** (เคยทำให้ infinite recursion → 500)
- ก่อน UPDATE/DELETE ข้อมูลจำนวนมาก ให้สำรองเป็นตาราง `bak_*` ก่อนเสมอ (และเพิกถอนสิทธิ์ `authenticated` / `anon` บนตารางสำรอง)
- ฟังก์ชันที่ policy เรียกใช้ต้องคงสิทธิ์ `authenticated` ไว้ (ถ้าถอน policy จะพังทั้งหมด) ส่วน Security Advisor ที่เตือนเรื่องนี้เป็นการตั้งใจ

## แก้ปัญหาที่เคยเจอ

| อาการ | สาเหตุ | วิธีแก้ |
|---|---|---|
| หน้าเว็บขาวหลัง deploy | `VITE_SUPABASE_URL` มีอักขระเกิน (เช่นวงเล็บ markdown) | ใส่ค่าธรรมดาใน Vercel แล้ว Redeploy (โค้ดจะแสดงข้อความ "ตั้งค่าระบบไม่ครบ" แทนจอขาว) |
| Login Google ไม่เข้า | Site URL / Redirect URLs ใน Supabase ไม่ตรงโดเมนจริง | ตั้งเป็นโดเมน Vercel |
| `app_users` ตอบ 500 | RLS recursion | ใช้ `public.is_admin()` ใน policy |
| นำเข้าไฟล์ไม่สำเร็จ | encounter เดียวหลายสิทธิชนกับ unique เดิม | ใช้ key encounter × coverage × payer (ผ่าน `import_admissions`) |
| ล้างค่าวันที่ในฟอร์มแล้วไม่หาย | ส่ง `undefined` แทน `null` | ส่ง `null` เมื่อเคลียร์ค่า |
| Dashboard โหลดช้า | ดึงข้อมูลทั้งหมดทีเดียว | แบ่งหน้า เรียงใหม่สุดก่อน (`search_admissions`) |
| ผู้ใช้ใหม่เข้าใช้งานไม่ได้ | ยังไม่ได้รับอนุมัติ | developer อนุมัติที่ไอคอนแจ้งเตือน / "จัดการผู้ใช้" บน navbar |

## ยังไม่ได้ทำ

- แนบไฟล์เอกสารประกอบเคส (Supabase Storage bucket)
- ปุ่มให้ผู้ดูแลปลดผู้ดูแลสิทธิใน My claim (ตอนนี้ต้องลบแถวใน `coverage_assignments` เอง)
- อัพเกรด `xlsx` (ยังเป็น `^0.18.5`) และตั้ง repo เป็น private
