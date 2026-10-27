// วางแผนการอัพเดตชีตแบบ "วางต่อท้าย + แก้แถวเดิม" (ไม่มีการเรียง/ย้ายแถวเดิม)
// ฟังก์ชันล้วน (ไม่แตะเครือข่าย) เพื่อทดสอบได้ — index.ts เป็นคนอ่าน/เขียนชีตจริง
//
// โครงชีต: A–G = ข้อมูลที่ Audit เห็น | H = รหัสแถว (admission_id) | I = สถานะ ('active' / 'void') — H, I ซ่อนไว้
// หลักเดียว: เทียบด้วยรหัสแถว
//   - รหัสยังไม่อยู่ในชีต            → วางต่อท้าย
//   - รหัสอยู่ในชีตแต่ข้อมูลต่างกัน   → แก้แถวเดิม
//   - รหัสอยู่ในชีตแต่เคสไม่เข้าเงื่อนไขแล้ว (เช่น เปลี่ยนเป็น UNK/DIS) → ทำสีแดง (void) ไม่ลบแถว
//   - เคสที่เคย void กลับมาเข้าเงื่อนไข → คืนสถานะ active และล้างสีแดง

export const DATA_COLS = 7 // A..G

export interface Elig {
  key: number // admission_id
  values: unknown[] // 7 ค่า A..G
}

export interface SheetRow {
  row: number // เลขแถวจริงในชีต (1-based; ข้อมูลเริ่มที่ 2)
  key: number | null
  status: string
  values: unknown[] // A..G
  hasContent: boolean // มีอะไรอยู่ในแถวนี้บ้าง (A..I)
}

export interface Plan {
  rebuild: boolean
  rebuildReason: string
  updates: { row: number; values: unknown[] }[]
  appends: Elig[]
  appendStart: number // แถวแรกที่จะวางต่อท้าย
  voids: number[] // แถวที่จะทำสีแดง
  restores: number[] // แถวที่จะล้างสีแดง
  duplicateKeys: number[]
  unchanged: number
}

const norm = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())

export function sameValues(a: unknown[], b: unknown[]): boolean {
  for (let i = 0; i < DATA_COLS; i++) if (norm(a[i]) !== norm(b[i])) return false
  return true
}

export function buildPlan(elig: Elig[], rows: SheetRow[], forceRebuild: boolean): Plan {
  const sortedElig = [...elig].sort((x, y) => x.key - y.key) // วางต่อท้ายตามลำดับรหัสแถว (ไม่เรียงตามวัน)
  const withContent = rows.filter((r) => r.hasContent)
  const unkeyed = withContent.filter((r) => r.key === null)

  if (forceRebuild || unkeyed.length > 0) {
    return {
      rebuild: true,
      rebuildReason: forceRebuild ? 'สั่งสร้างชีตใหม่ทั้งหมด' : `ชีตยังไม่มีรหัสแถว (${unkeyed.length} แถว) — สร้างใหม่ครั้งแรก`,
      updates: [],
      appends: sortedElig,
      appendStart: 2,
      voids: [],
      restores: [],
      duplicateKeys: [],
      unchanged: 0,
    }
  }

  const byKey = new Map<number, SheetRow>()
  const dup = new Set<number>()
  for (const r of withContent) {
    if (r.key === null) continue
    if (byKey.has(r.key)) dup.add(r.key)
    else byKey.set(r.key, r)
  }
  const lastRow = withContent.reduce((m, r) => Math.max(m, r.row), 1)

  const plan: Plan = {
    rebuild: false,
    rebuildReason: '',
    updates: [],
    appends: [],
    appendStart: lastRow + 1,
    voids: [],
    restores: [],
    duplicateKeys: [...dup],
    unchanged: 0,
  }

  const eligKeys = new Set<number>()
  for (const e of sortedElig) {
    eligKeys.add(e.key)
    const hit = byKey.get(e.key)
    if (!hit) {
      plan.appends.push(e)
      continue
    }
    let touched = false
    if (!sameValues(hit.values, e.values)) {
      plan.updates.push({ row: hit.row, values: e.values })
      touched = true
    }
    if (hit.status === 'void') {
      plan.restores.push(hit.row)
      touched = true
    }
    if (!touched) plan.unchanged++
  }
  for (const [key, r] of byKey) {
    if (!eligKeys.has(key) && r.status !== 'void') plan.voids.push(r.row)
  }
  return plan
}

/** แปลงผลอ่านจากชีต (A2:I…) เป็น SheetRow — แถวว่างระหว่างทางจะมี hasContent = false */
export function parseSheetRows(raw: unknown[][], firstRow = 2): SheetRow[] {
  return raw.map((cells, i) => {
    const c = cells ?? []
    const k = c[7]
    const key = typeof k === 'number' && Number.isInteger(k) ? k : /^\d+$/.test(norm(k)) ? Number(norm(k)) : null
    return {
      row: firstRow + i,
      key,
      status: norm(c[8]),
      values: Array.from({ length: DATA_COLS }, (_, j) => c[j]),
      hasContent: c.some((x) => norm(x) !== ''),
    }
  })
}
