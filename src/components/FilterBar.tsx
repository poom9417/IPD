interface Props {
  search: string
  onSearchChange: (v: string) => void
  division: string
  onDivisionChange: (v: string) => void
  divisions: string[]
  statusFilter: 'all' | 'active' | 'discharged'
  onStatusFilterChange: (v: 'all' | 'active' | 'discharged') => void
}

export default function FilterBar({
  search,
  onSearchChange,
  division,
  onDivisionChange,
  divisions,
  statusFilter,
  onStatusFilterChange,
}: Props) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <input
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="ค้นหา HN หรือชื่อผู้ป่วย…"
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-teal/30 sm:max-w-xs"
      />

      <select
        value={division}
        onChange={(e) => onDivisionChange(e.target.value)}
        className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/30"
      >
        <option value="">ทุกหอผู้ป่วย</option>
        {divisions.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>

      <div className="flex rounded-lg border border-line bg-surface p-0.5 text-sm">
        {(
          [
            { key: 'all', label: 'ทั้งหมด' },
            { key: 'active', label: 'กำลังนอน' },
            { key: 'discharged', label: 'จำหน่ายแล้ว' },
          ] as const
        ).map((opt) => (
          <button
            key={opt.key}
            onClick={() => onStatusFilterChange(opt.key)}
            className={
              'rounded-md px-3 py-1.5 transition-colors ' +
              (statusFilter === opt.key
                ? 'bg-teal-soft text-teal-dark font-medium'
                : 'text-ink/60 hover:text-ink')
            }
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
