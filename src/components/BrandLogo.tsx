interface Props {
  className?: string
}

/**
 * โลโก้สถาบันการแพทย์จักรีนฤบดินทร์ (CNMI) แสดงเป็นโทนเหลือง/ทอง (var(--color-brand))
 * ใช้เทคนิค CSS mask แทนการฝังไฟล์ภาพ เพื่อคุมสีให้เข้ากับธีมโดยไม่ต้องแก้ไฟล์ต้นฉบับ
 * ถ้าต้องการ self-host แทนการโหลดจาก Wikimedia ให้ดาวน์โหลดไฟล์ svg มาไว้ที่
 * src/assets/cnmi-logo.svg แล้วแก้ url(...) ใน .brand-logo (src/index.css) เป็น
 * url('/src/assets/cnmi-logo.svg') แทน
 */
export default function BrandLogo({ className = 'h-8 w-8' }: Props) {
  return <span role="img" aria-label="สถาบันการแพทย์จักรีนฤบดินทร์" className={`brand-logo ${className}`} />
}
