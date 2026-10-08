import type { UiRole } from './types'
import type { PageKey } from '../components/NavMenu'

/**
 * เลข version ของทัวร์ — เพิ่มเลขนี้ "เฉพาะ" เมื่อเปลี่ยนโฟลว์การทำงานใหญ่ ๆ
 * (ผู้ใช้ทุกคนจะเห็นทัวร์อีกครั้ง) การปรับเล็กน้อยห้ามเพิ่มเลข
 */
export const TOUR_VERSION = 1

/**
 * เลขย่อยของเนื้อหาทัวร์ (v1.1, v1.2 …) — เพิ่มเมื่อเพิ่ม/แก้คำอธิบายปุ่มใหม่
 * ไม่ทำให้ผู้ใช้เห็นทัวร์ซ้ำเอง (ซ้ำเฉพาะเมื่อ TOUR_VERSION เปลี่ยน)
 */
export const TOUR_MINOR = 1
export const TOUR_LABEL = `v${TOUR_VERSION}.${TOUR_MINOR}`

export interface TourStep {
  id: string
  /** หน้าที่ต้องอยู่ตอนโชว์ขั้นตอนนี้ (ทัวร์พาไปให้เอง) */
  page: PageKey
  /** ค่า data-tour ของ element ที่จะไฮไลต์ — ถ้าหาไม่เจอ (เช่นยังไม่มีข้อมูล) จะข้ามขั้นตอนนี้ */
  target: string
  title: string
  body: string
  roles: UiRole[]
  /** แสดงเฉพาะบัญชี Developer (role จริง) แม้กำลังจำลองเป็น role อื่น */
  dev?: boolean
  /** เปิดเมนู Menu ค้างไว้ระหว่างขั้นตอนนี้ */
  menu?: boolean
}

const ALL: UiRole[] = ['admin', 'user', 'audit', 'viewer']
const EDIT: UiRole[] = ['admin', 'user']

export const ROLE_INTRO: Record<UiRole, { name: string; can: string[] }> = {
  admin: {
    name: 'ผู้ดูแลระบบ',
    can: [
      'ดู แก้ไข และลบเคสได้ทุกเคส',
      'นำเข้าเคสใหม่ และอัพโหลดสถานะเคลมได้ทุกขั้น',
      'จัดการสิทธิ์และหน่วยงานของผู้ใช้',
      'ใช้ Code C และ My job',
    ],
  },
  user: {
    name: 'ผู้ใช้ทั่วไป',
    can: [
      'รับเอกสาร (กรอกยอด) และแก้ยอด/วันที่รับเอกสาร',
      'เพิ่มเคส และอัพโหลดสถานะเคลม (รับเอกสาร / ส่งเบิก)',
      'แจ้งเคสติด C ที่หน้า Code C',
      'เลือกสิทธิที่ดูแลและดูระยะเวลาส่งเบิกที่ My job',
    ],
  },
  audit: {
    name: 'Audit',
    can: [
      'บันทึกวัน Audit (ทีละเคส หรืออัพโหลดไฟล์)',
      'ตอบวิธีแก้ไขเคสที่ติด Code C',
      'ดูข้อมูลเคสและ Export Excel',
    ],
  },
  viewer: {
    name: 'ผู้ดูข้อมูล (ดูอย่างเดียว)',
    can: ['ดูข้อมูลเคสและรายละเอียด', 'กรองข้อมูล และ Export Excel', 'ดูหน้า Code C'],
  },
}

export const TOUR_STEPS: TourStep[] = [
  // ---------- ส่วนกลาง (แถบด้านบน) ----------
  {
    id: 'user-info', page: 'mine', target: 'user-info', roles: ALL,
    title: 'บัญชีและสิทธิ์ของคุณ',
    body: 'แสดงอีเมลและ role ที่คุณใช้อยู่ ซึ่งกำหนดว่าปุ่มไหนใช้ได้ ถ้าต้องการเปลี่ยน role ให้แจ้งผู้ดูแลระบบ',
  },
  {
    id: 'simulate-role', page: 'mine', target: 'simulate-role', roles: ALL, dev: true,
    title: 'จำลองเป็น role อื่น (Developer)',
    body: 'เลือก role เพื่อดูหน้าเว็บเหมือนเป็นคนนั้น โดย role จริงของคุณไม่ถูกเปลี่ยน มีแถบสีเหลืองด้านบนแจ้งว่ากำลังจำลองอยู่ กด "ออกจากโหมดจำลอง" เพื่อกลับมา และคนอื่นแก้ role Developer ของคุณไม่ได้',
  },
  {
    id: 'menu-edit', page: 'mine', target: 'menu-list', menu: true, roles: EDIT,
    title: 'เมนูหน้าต่างๆ',
    body: 'หน้าหลัก = รับเอกสาร/ส่งเบิกเคสทั้งหมด · Code C = เคสที่ติด C หลังส่งเบิก · My job = งานของสิทธิที่คุณดูแล (Dashboard ระยะเวลาส่งเบิก และ My claim เลือกสิทธิ) เลื่อนเมาส์ไปที่ปุ่ม Menu เพื่อเปิด',
  },
  {
    id: 'menu-other', page: 'mine', target: 'menu-list', menu: true, roles: ['audit', 'viewer'],
    title: 'เมนูหน้าต่างๆ',
    body: 'หน้าหลัก = ข้อมูลเคสทั้งหมด · Code C = เคสที่ติด C หลังส่งเบิก เลื่อนเมาส์ไปที่ปุ่ม Menu เพื่อเปิด',
  },
  {
    id: 'manage-users', page: 'mine', target: 'manage-users', roles: ['admin'],
    title: 'จัดการผู้ใช้',
    body: 'กำหนด role (ดูอย่างเดียว / ผู้ใช้ทั่วไป / Audit / Admin) และหน่วยงานของผู้ใช้แต่ละคน วางไว้ข้างชื่อเพื่อไม่ให้กดพลาด',
  },

  // ---------- หน้าหลัก ----------
  {
    id: 'stat-cards', page: 'mine', target: 'stat-cards', roles: ALL,
    title: 'ตัวเลขสรุป',
    body: 'จำนวนเคส จำนวนผู้ป่วย LOS เฉลี่ย และยอด claim จาก HIS รวม คำนวณจากเคสที่แสดงอยู่ตามตัวกรอง',
  },
  {
    id: 'filters', page: 'mine', target: 'filters', roles: ALL,
    title: 'ตัวกรอง',
    body: 'ค้นหาด้วย HN, AN, ชื่อ หรือ encounter_id กรองหอผู้ป่วย สถานะเคลม ผู้จ่าย เลือกสิทธิได้หลายอัน และเลือกช่วงวันจำหน่าย (มีปุ่มลัด เมื่อวาน / 7 วันล่าสุด / เดือนนี้ / เดือนที่แล้ว)',
  },
  {
    id: 'only-mine', page: 'mine', target: 'only-mine', roles: EDIT,
    title: 'เฉพาะสิทธิของฉัน',
    body: 'แสดงเฉพาะเคสของสิทธิ+ผู้จ่ายที่คุณเลือกดูแลไว้ที่ My job ปุ่มนี้จะโผล่เมื่อคุณเลือกสิทธิที่ดูแลแล้ว',
  },
  {
    id: 'export', page: 'mine', target: 'export', roles: ['admin', 'user', 'viewer'],
    title: 'Export Excel',
    body: 'ส่งออกเคสเป็นไฟล์ Excel ตามตัวกรองบนหน้าจอ ถ้าไม่ได้ตั้งตัวกรองจะส่งออกทั้งหมด',
  },
  {
    id: 'export-audit', page: 'mine', target: 'export', roles: ['audit'],
    title: 'Export Excel (สำหรับ Audit)',
    body: 'ส่งออกเป็น Excel ตามตัวกรองบนหน้าจอ โดย role Audit จะได้เฉพาะคอลัมน์ HN, AN, encounter_id, ชื่อผู้ป่วย, coverage_code, payer_id, วันที่จำหน่าย',
  },
  {
    id: 'import', page: 'mine', target: 'import', roles: ['admin'],
    title: 'นำเข้าเคสใหม่ (CSV)',
    body: 'นำเข้าไฟล์เคสผู้ป่วยในจากระบบ HIS ระบบจะเพิ่มผู้ป่วย สิทธิ และผู้จ่ายใหม่ให้อัตโนมัติ เคสที่ไม่มีสิทธิ/ผู้จ่ายจะเก็บเป็น UNK',
  },
  {
    id: 'bulk-edit', page: 'mine', target: 'bulk', roles: ['admin', 'user'],
    title: 'อัพโหลดสถานะเคลม (CSV)',
    body: 'อัปเดตสถานะหลายเคสพร้อมกันจากไฟล์ เช่น วันที่ส่งเบิกจากไฟล์ตั้งเบิกของ GGO ผู้ใช้ทั่วไปอัปโหลดได้เฉพาะขั้นรับเอกสารและส่งเบิก',
  },
  {
    id: 'bulk-audit', page: 'mine', target: 'bulk', roles: ['audit'],
    title: 'อัพโหลดวัน Audit (CSV)',
    body: 'บันทึกวัน Audit หลายเคสพร้อมกันจากไฟล์ ใช้ encounter_id เป็นตัวจับคู่',
  },
  {
    id: 'add-case', page: 'mine', target: 'add-case', roles: EDIT,
    title: '+ เพิ่มเคส',
    body: 'พิมพ์ HN หรือชื่อเพื่อค้นผู้ป่วยเดิม ระบบจะเติมข้อมูลที่เหลือให้ สิทธิ ผู้จ่าย และหอผู้ป่วยที่ยังไม่มีในรายการเพิ่มใหม่เองได้',
  },
  {
    id: 'cases-table', page: 'mine', target: 'cases-table', roles: ALL,
    title: 'ตารางเคส',
    body: 'คลิกที่แถวใดก็ได้เพื่อเปิดรายละเอียดเต็มของเคสแบบอ่านอย่างเดียว คอลัมน์จำนวนวันหลัง Audit ใช้ดูว่าเคสค้างส่งเบิกมานานแค่ไหน',
  },
  {
    id: 'claim-edit', page: 'mine', target: 'claim-status', roles: EDIT,
    title: 'สถานะเคลม: รับเอกสาร',
    body: 'ป้ายสถานะมี 3 ขั้น: รับเอกสาร → Audit → ส่งเบิก กดป้าย "รับเอกสาร" แล้วกรอกยอดและยืนยัน ระบบบันทึกวันที่รับเอกสารเป็นวันนี้ ถ้ากรอกผิดกดป้ายเดิมอีกครั้งเพื่อแก้วันที่/ยอด',
  },
  {
    id: 'claim-audit', page: 'mine', target: 'claim-status', roles: ['audit'],
    title: 'สถานะเคลม: Audit',
    body: 'ป้ายสถานะมี 3 ขั้น: รับเอกสาร → Audit → ส่งเบิก กดป้าย Audit เพื่อบันทึกว่า Audit เคสนี้แล้ววันนี้ (ขั้นอื่นดูได้อย่างเดียว)',
  },
  {
    id: 'claim-view', page: 'mine', target: 'claim-status', roles: ['viewer'],
    title: 'สถานะเคลม',
    body: 'ป้ายสถานะมี 3 ขั้น: รับเอกสาร → Audit → ส่งเบิก ที่ติ๊กแล้วคือขั้นที่เสร็จแล้ว บัญชีนี้ดูได้อย่างเดียว',
  },
  {
    id: 'edit-btn', page: 'mine', target: 'edit-btn', roles: ['admin'],
    title: 'แก้ไขเคส',
    body: 'เปิดฟอร์มแก้ไขได้ทุกช่อง ลบค่าที่กรอกผิดได้ และมีปุ่มลบเคสสีแดงอยู่ด้านซ้าย (ต้องกดยืนยันซ้ำ)',
  },

  // ---------- Code C ----------
  {
    id: 'codec-report', page: 'codec', target: 'codec-report', roles: EDIT,
    title: '+ แจ้งเคสติด C',
    body: 'เลือกเคสที่ส่งเบิกแล้ว (ค้นด้วยชื่อหรือ encounter_id) แล้วระบุสาเหตุที่ติด C ส่วน dateline ระบบนับให้เองจากวันจำหน่าย + 7 วัน ไม่ต้องกรอก และประทับวันเวลาพร้อมชื่อผู้บันทึกให้อัตโนมัติ',
  },
  {
    id: 'codec-stats', page: 'codec', target: 'codec-stats', roles: ALL,
    title: 'สรุป Code C',
    body: 'จำนวนทั้งหมด จำนวนที่รอ Audit แก้ไข และจำนวนที่เกิน dateline แล้ว',
  },
  {
    id: 'codec-filters', page: 'codec', target: 'codec-filters', roles: ALL,
    title: 'ค้นหาและกรอง',
    body: 'ค้นด้วยชื่อ / encounter_id / HN และกรองตามสถานะ (รอ Audit แก้ไข / แก้ไขแล้ว)',
  },
  {
    id: 'codec-table', page: 'codec', target: 'codec-table', roles: ALL,
    title: 'รายการเคสติด C',
    body: 'ฝั่งซ้ายคือสาเหตุที่ user แจ้ง ฝั่งขวาคือวิธีแก้ที่ Audit ตอบ ทั้งสองฝั่งมีวันเวลาและชื่อผู้บันทึกกำกับ คอลัมน์ dateline แสดง "วันที่ x / 7" นับจากวันจำหน่าย ถ้าเกินจะขึ้นสีแดง เคสที่ถูกส่งกลับจะมี "รอบที่ N" และเปิดดู "ประวัติการแก้ไข" ได้ว่าเคยแก้อะไรไปแล้ว',
  },
  {
    id: 'codec-reply', page: 'codec', target: 'codec-reply', roles: ['admin', 'audit'],
    title: 'ตอบวิธีแก้ไข',
    body: 'Audit กดตอบเพื่อบันทึกว่าแก้ไขอย่างไร ระบบบันทึกวันที่ตอบแยกจากฝั่ง user เมื่อตอบแล้วถือว่าผ่านโดยอัตโนมัติ ถ้า user ส่งกลับ ปุ่มจะเป็น "ตอบรอบที่ N" และเห็นคำตอบเดิมกับวันที่ แก้คำตอบภายหลังได้ คำตอบเดิมเก็บไว้ในประวัติ',
  },
  {
    id: 'codec-reopen', page: 'codec', target: 'codec-reopen', roles: ['user'],
    title: 'ไม่ผ่านการแก้ C',
    body: 'ใช้เมื่อ Audit ตอบแล้วแต่เคสยังติด C กดแล้วเคสจะกลับเป็น "รอ Audit แก้ไข" รอบถัดไป (มีหน้าต่างยืนยัน และใส่เหตุผลได้ ไม่บังคับ) dateline นับต่อโดยไม่รีเซ็ต ถ้าการแก้ไม่มีปัญหา ไม่ต้องกดอะไร ระบบถือว่าผ่านแล้ว ปุ่มนี้จะโผล่เมื่อ Audit ตอบเคสแล้ว',
  },

  // ---------- My job ----------
  {
    id: 'claim-toolbar', page: 'myjob-claim', target: 'claim-toolbar', roles: EDIT,
    title: 'My claim: เลือกสิทธิที่ดูแล',
    body: 'ค้นหาสิทธิหรือผู้จ่ายแล้วติ๊กเลือกในตาราง ปุ่ม "เลือกที่ว่างทั้งหมด" / "ล้าง" ช่วยเลือกเร็ว กด "บันทึก" เมื่อเสร็จ สิทธิ+ผู้จ่ายหนึ่งรายการมีผู้ดูแลได้คนเดียว เลือกแล้วคนอื่นเลือกซ้ำไม่ได้',
  },
  {
    id: 'claim-table', page: 'myjob-claim', target: 'claim-table', roles: EDIT,
    title: 'ตารางสิทธิ + ผู้จ่าย',
    body: 'ดูว่าแต่ละสิทธิ+ผู้จ่ายมีกี่เคส และใครดูแลอยู่ ("ฉัน" = คุณ, "ว่าง" = ยังไม่มีผู้ดูแล)',
  },
  {
    id: 'mydash-filters', page: 'myjob-dashboard', target: 'mydash-filters', roles: EDIT,
    title: 'My job Dashboard: ตัวกรอง',
    body: 'เลือกวิธีนับระยะเวลาส่งเบิก กรองสิทธิ (เฉพาะที่คุณดูแล) ผู้จ่าย และช่วงวันจำหน่าย ตั้งเป้าหมายเป็นจำนวนวันได้',
  },
  {
    id: 'mydash-cases', page: 'myjob-dashboard', target: 'mydash-cases', roles: EDIT,
    title: 'ระยะเวลาส่งเบิกรายเคส',
    body: 'ดูว่าแต่ละเคสส่งเบิกแล้วหรือยังค้างอยู่ และใช้กี่วัน เคสที่ยังไม่ส่งเบิกจะนับอายุถึงวันนี้',
  },

  // ---------- ท้ายทัวร์ ----------
  {
    id: 'tour-again', page: 'mine', target: 'tour-again', roles: ALL,
    title: 'ดูคู่มืออีกครั้ง',
    body: 'กดปุ่ม "คู่มือใช้งาน" ได้ทุกเมื่อเพื่อเปิดทัวร์นี้ซ้ำ',
  },
]
