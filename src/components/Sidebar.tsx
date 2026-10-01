import { useAuth } from '../contexts/AuthContext'

export type PageKey = 'mine' | 'codec' | 'myjob'

const ITEMS: { key: PageKey; label: string; sub: string; needsJob?: boolean }[] = [
  { key: 'mine', label: 'Mine', sub: 'รับเอกสาร / ส่งเบิก' },
  { key: 'codec', label: 'Code C', sub: 'เคสติด C หลังส่งเบิก' },
  { key: 'myjob', label: 'My job', sub: 'สิทธิที่ฉันดูแล', needsJob: true },
]

interface Props {
  page: PageKey
  onChange: (p: PageKey) => void
}

export default function Sidebar({ page, onChange }: Props) {
  const { role } = useAuth()
  // viewer (ดูอย่างเดียว) ไม่มีหน้า My job
  const canJob = role === 'admin' || role === 'user' || role === 'audit'
  const items = ITEMS.filter((i) => !i.needsJob || canJob)

  return (
    <nav className="shrink-0 border-b border-line bg-white md:w-56 md:border-b-0 md:border-r">
      <ul className="flex gap-1 overflow-x-auto p-2 md:sticky md:top-0 md:flex-col md:gap-1.5 md:p-3">
        {items.map((i) => {
          const active = page === i.key
          return (
            <li key={i.key} className="shrink-0">
              <button
                onClick={() => onChange(i.key)}
                aria-current={active ? 'page' : undefined}
                className={
                  'w-full rounded-lg border-l-4 px-3 py-2.5 text-left transition-colors ' +
                  (active
                    ? 'border-ink bg-brand text-ink'
                    : 'border-transparent text-ink hover:bg-brand-soft')
                }
              >
                <span className="block text-sm font-semibold leading-tight">{i.label}</span>
                <span className="block whitespace-nowrap text-xs text-ink/70">{i.sub}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
