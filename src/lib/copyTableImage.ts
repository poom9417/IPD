import { toBlob } from 'html-to-image'

/**
 * แปลง element (ตาราง) เป็นภาพ PNG แล้วคัดลอกลงคลิปบอร์ด เพื่อวางใน PowerPoint / Canva ได้ทันที
 * ถ้าเบราว์เซอร์ไม่รองรับการคัดลอกภาพ จะดาวน์โหลดเป็นไฟล์ .png แทน
 * คืนค่า 'copied' | 'downloaded'
 */
export async function copyElementAsImage(el: HTMLElement, fileName = 'ar-summary'): Promise<'copied' | 'downloaded'> {
  const blob = await toBlob(el, {
    pixelRatio: 2, // ความคมชัดสูงขึ้น เหมาะกับสไลด์
    backgroundColor: '#ffffff',
    // จับทั้งตารางแม้กว้างกว่าหน้าจอ (ไม่ถูกตัดด้วย scroll)
    width: el.scrollWidth,
    height: el.scrollHeight,
  })
  if (!blob) throw new Error('สร้างภาพตารางไม่สำเร็จ')

  if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      return 'copied'
    } catch {
      // ตกไปดาวน์โหลดแทน
    }
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${fileName}-${new Date().toISOString().slice(0, 10)}.png`
  a.click()
  URL.revokeObjectURL(url)
  return 'downloaded'
}
