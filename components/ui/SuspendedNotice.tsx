// components/ui/SuspendedNotice.tsx
import { LogoutButton } from './LogoutButton'

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'suporte@arenahub.website'

// Tela terminal exibida quando a academia do usuário está suspensa. Bloqueia o
// conteúdo autenticado (aluno e admin) sem redirect (evita loop). Reutilizada
// pelos layouts (dashboard) e (admin).
export function SuspendedNotice() {
  return (
    <div className="min-h-screen bg-surface text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-surface-border bg-surface-card p-6 text-center">
        <h1 className="text-xl font-bold">Academia suspensa</h1>
        <p className="text-sm text-slate-400">
          O acesso a esta academia está temporariamente suspenso. Para regularizar a
          situação, entre em contato com o suporte:{' '}
          <a className="text-brand-400 hover:text-brand-300" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
        <LogoutButton className="inline-flex items-center justify-center rounded-lg bg-surface-border px-4 py-2 text-sm font-semibold text-white hover:bg-surface-border/70">
          Sair
        </LogoutButton>
      </div>
    </div>
  )
}
