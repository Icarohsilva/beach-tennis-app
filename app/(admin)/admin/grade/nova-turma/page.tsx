import Link from 'next/link'
import { ClassForm } from '@/features/aulas/ClassForm'
import { requirePlatformAccess } from '@/lib/billing/guard'

export default async function NovaTurmaPage() {
  await requirePlatformAccess() // gate de cobranca; ver lib/billing/guard.ts
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/grade" className="text-slate-400 hover:text-white text-sm">
          ← Grade
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold text-white">Nova Turma</h1>
        <p className="text-slate-400 text-sm mt-1">
          A turma ficará visível para alunos com nível compatível.
        </p>
      </div>
      <ClassForm />
    </div>
  )
}
