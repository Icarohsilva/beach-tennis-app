// components/ui/StatHeader.tsx

interface Stat {
  label: string
  value: string | number
}

interface StatHeaderProps {
  name: string
  stats: Stat[]
}

export function StatHeader({ name, stats }: StatHeaderProps) {
  return (
    <div className="rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-4 shadow-lg shadow-brand-900/30">
      <p className="text-lg font-extrabold text-white">Olá, {name} 🎾</p>
      <div className="mt-3 flex gap-6">
        {stats.map((s) => (
          <div key={s.label}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-orange-100/80">{s.label}</p>
            <p className="text-xl font-extrabold text-white">{s.value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
