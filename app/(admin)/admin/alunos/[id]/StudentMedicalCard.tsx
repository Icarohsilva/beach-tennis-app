// app/(admin)/admin/alunos/[id]/StudentMedicalCard.tsx
// Ficha médica em modo leitura — quem edita continua sendo o próprio aluno
// em /perfil (features/perfil/MedicalForm.tsx). O admin só precisa enxergar
// isso rápido numa emergência na quadra; duas telas editando o mesmo dado
// criaria duas fontes de verdade sobre a saúde de alguém.
import { Card } from '@/components/ui/Card'
import { formatDate } from '@/lib/utils/dateHelpers'

interface Props {
  medical: {
    birth_date: string | null
    blood_type: string | null
    emergency_name: string | null
    emergency_phone: string | null
    health_notes: string | null
  } | null
}

export function StudentMedicalCard({ medical }: Props) {
  const hasAnything =
    medical &&
    (medical.birth_date || medical.blood_type || medical.emergency_name || medical.emergency_phone || medical.health_notes)

  return (
    <Card>
      <h2 className="text-base font-semibold text-white mb-3">Ficha médica</h2>
      {!hasAnything ? (
        <p className="text-sm text-slate-500">Este aluno ainda não preencheu a ficha médica.</p>
      ) : (
        <dl className="space-y-2 text-sm">
          {medical!.birth_date && (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-400">Nascimento</dt>
              <dd className="text-white text-right">{formatDate(medical!.birth_date)}</dd>
            </div>
          )}
          {medical!.blood_type && (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-400">Tipo sanguíneo</dt>
              <dd className="text-white text-right">{medical!.blood_type}</dd>
            </div>
          )}
          {(medical!.emergency_name || medical!.emergency_phone) && (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-400 shrink-0">Contato de emergência</dt>
              <dd className="text-white text-right min-w-0">
                {medical!.emergency_name}
                {medical!.emergency_phone && (
                  <span className="block text-slate-400">{medical!.emergency_phone}</span>
                )}
              </dd>
            </div>
          )}
          {medical!.health_notes && (
            <div>
              <dt className="text-slate-400 mb-1">Observações médicas</dt>
              <dd className="text-white whitespace-pre-line">{medical!.health_notes}</dd>
            </div>
          )}
        </dl>
      )}
    </Card>
  )
}
