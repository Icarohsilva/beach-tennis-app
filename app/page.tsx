// app/page.tsx
import Link from 'next/link'
import { Button } from '@/components/ui/Button'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-surface text-white">
      <div className="max-w-lg mx-auto px-4 py-12 flex flex-col gap-8">
        <header className="text-center">
          <h1 className="text-4xl font-black text-brand-500">🎾 BT App</h1>
          <p className="text-slate-300 mt-2 text-lg">Academia Hudson Barros</p>
        </header>

        <div className="flex flex-col gap-3 text-center text-slate-400 text-sm">
          <p>📅 Segunda a sexta: 7h – 22h</p>
          <p>📅 Sábado: 7h – 12h</p>
          <p>🎾 Turmas por nível: A · B · C · D · Iniciante</p>
          <p>👶 Aulas kids disponíveis</p>
        </div>

        <div className="flex flex-col gap-3">
          <Link href="/experimental">
            <Button size="lg" className="w-full">Agendar aula experimental gratuita</Button>
          </Link>
          <Link href="/login">
            <Button size="lg" variant="secondary" className="w-full">Entrar / Criar conta</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
