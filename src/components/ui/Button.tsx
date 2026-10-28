import type { ButtonHTMLAttributes } from 'react'

/** ชนิดปุ่ม — สไตล์จริงอยู่ที่ src/styles/components/button.css (.btn-primary ฯลฯ) */
export type ButtonVariant = 'primary' | 'outline' | 'danger' | 'icon'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

/**
 * ปุ่มกลางของระบบ — ใช้แทน <button className="rounded-lg bg-brand ..."> ที่เคยเขียนซ้ำทุกหน้า
 * ไม่กำหนด type ให้เอง (ทำงานเหมือน <button> ปกติ: ในฟอร์มคือ submit ถ้าไม่ใส่ type="button")
 * className ที่ส่งเพิ่มมาจะต่อท้าย (เช่น whitespace-nowrap, w-full) และ override ตัวแปรได้
 */
export default function Button({ variant = 'primary', className, ...rest }: ButtonProps) {
  const cls = `btn-${variant}${className ? ` ${className}` : ''}`
  return <button className={cls} {...rest} />
}
