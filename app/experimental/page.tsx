// app/experimental/page.tsx
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

export default function ExperimentalPage() {
  return (
    <div className="min-h-screen bg-surface text-white flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-bold text-white mb-2">Aula Experimental</h1>
        <p className="text-slate-400 text-sm mb-6">
          Gratuita na primeira vez. Sem precisar criar conta.
        </p>
        <Card>
          <p className="text-slate-400 text-sm text-center py-4">
            Formulário de agendamento — implementado no Plano 2
          </p>
        </Card>
      </div>
    </div>
  )
}
