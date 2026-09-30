interface Props {
  search: string
  onSearchChange: (v: string) => void
  division: string
  onDivisionChange: (v: string) => void
  divisions: string[]
}

export default function FilterBar({
  search,
  onSearchChange,
  division,
  onDivisionChange,
  divisions,
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
    </div>
  )
}
