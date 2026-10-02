// คีย์ของ "สิทธิ + ผู้จ่าย" เช่น GGO|50258 — ใช้เทียบว่าเคสนี้อยู่ในงานที่ฉันดูแลหรือไม่
export const pairKey = (coverageCode: string | null | undefined, payerId: string | null | undefined) =>
  `${coverageCode ?? ''}|${payerId ?? ''}`
