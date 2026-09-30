import type { Admission } from './types'

// ขั้นตอนเคลม นับจาก "ความคืบหน้าล่าสุด" ของแถวนั้น
export type ClaimStage = 'pending_doc' | 'pending_audit' | 'pending_submit' | 'submitted'

export const CLAIM_STAGE_LABELS: Record<ClaimStage, string> = {
  pending_doc: 'รอรับเอกสาร',
  pending_audit: 'รอ Audit',
  pending_submit: 'รอส่งเบิก',
  submitted: 'ส่งเบิกแล้ว',
}

export function getClaimStage(a: Admission): ClaimStage {
  const ct = a.case_tracking
  if (ct?.submission_date) return 'submitted'
  if (ct?.audit_date) return 'pending_submit'
  if (ct?.document_received_date) return 'pending_audit'
  return 'pending_doc'
}
