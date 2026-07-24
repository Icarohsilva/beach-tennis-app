import { Logo } from '@/components/ui/Logo'
import { LegalFooterLinks } from '@/components/ui/LegalFooterLinks'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8 gap-3">
          <Logo variant="full" size="md" />
          <p className="text-slate-400 text-sm">Gestão para arenas e academias</p>
        </div>
        {children}
        <LegalFooterLinks className="mt-6" />
      </div>
    </div>
  )
}
