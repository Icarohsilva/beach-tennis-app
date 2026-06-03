import { Logo } from '@/components/ui/Logo'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8 gap-3">
          <Logo variant="full" size="md" />
          <p className="text-slate-400 text-sm">Academia Hudson Barros</p>
        </div>
        {children}
      </div>
    </div>
  )
}
