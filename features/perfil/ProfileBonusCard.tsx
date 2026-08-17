// features/perfil/ProfileBonusCard.tsx
import { Gift } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import type { ProfileBonusStatus } from '@/features/liga/queries'

interface Props {
  status: ProfileBonusStatus | null
}

/**
 * O que falta para o aluno receber o bônus de cadastro completo.
 *
 * O bônus é a única fonte de ponto que depende de o aluno preencher algo, e era a única
 * sem retorno: ele preenchia, não ganhava, e não tinha como descobrir por quê. Aconteceu
 * de verdade — faltava o telefone de emergência e nada na tela dizia isso.
 *
 * Só aparece quando há de fato o que fazer: `getProfileBonusStatus` devolve null com a
 * Liga desligada, a fonte zerada, o bônus já recebido ou o cadastro já completo. Card no
 * meio da tela, não banner de topo nem modal: o aluno chega no Perfil para resolver algo,
 * e este card fica ao lado dos formulários que preenchem exatamente estes campos.
 */
export function ProfileBonusCard({ status }: Props) {
  if (!status) return null

  return (
    <Card className="border-brand-500/30 bg-brand-500/[0.06]">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/10">
          <Gift className="h-4.5 w-4.5 text-brand-500" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">
            {status.missing.length === 1
              ? 'Falta 1 campo'
              : `Faltam ${status.missing.length} campos`}{' '}
            para você ganhar <span className="text-brand-500">+{status.points} pontos</span> na
            Liga
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            É uma vez só, e vale para a temporada em que você completar.
          </p>

          <ul className="mt-2.5 space-y-1">
            {status.missing.map((campo) => (
              <li key={campo} className="flex items-start gap-2 text-sm text-slate-200">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                {campo}
              </li>
            ))}
          </ul>

          <p className="mt-2.5 text-xs text-slate-500">
            Preencha nos formulários abaixo — o ponto entra sozinho assim que salvar.
          </p>
        </div>
      </div>
    </Card>
  )
}
