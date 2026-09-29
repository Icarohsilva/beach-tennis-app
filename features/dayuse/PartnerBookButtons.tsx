'use client'
// features/dayuse/PartnerBookButtons.tsx
// "Vou de Wellhub / TotalPass" ao lado do botão de reservar do day use.
//
// Um componente só para as três telas que reservam (card de /agendar/dayuse,
// modal da agenda e link público): a opção e o aviso antes de confirmar não
// podem mudar de uma tela para outra.
import { Button } from '@/components/ui/Button'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import {
  PARTNER_SHORT_LABEL,
  partnerBookingWarning,
  type DayUsePartner,
} from '@/lib/dayuse/partnerCheckin'
import { formatDayUsePrice } from '@/lib/dayuse/dayUseKind'

interface Props {
  options: DayUsePartner[]
  priceCents: number
  disabled?: boolean
  onPick: (partner: DayUsePartner) => void
  /** 'sm' no card compacto; 'md' no modal e na página pública. */
  size?: 'sm' | 'md'
}

export function PartnerBookButtons({ options, priceCents, disabled, onPick, size = 'md' }: Props) {
  const { confirm, dialog } = useConfirm()
  if (options.length === 0) return null

  async function pick(partner: DayUsePartner) {
    const { ok } = await confirm({
      title: `Reservar com ${PARTNER_SHORT_LABEL[partner]}?`,
      message: partnerBookingWarning(partner, formatDayUsePrice(priceCents)),
      confirmLabel: 'Reservar',
      cancelLabel: 'Voltar',
    })
    if (ok) onPick(partner)
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-slate-400">Vai de parceiro?</p>
      <div className="flex flex-wrap gap-2">
        {options.map((partner) => (
          <Button
            key={partner}
            type="button"
            variant="secondary"
            size={size}
            disabled={disabled}
            onClick={() => pick(partner)}
          >
            Usar {PARTNER_SHORT_LABEL[partner]}
          </Button>
        ))}
      </div>
      {dialog}
    </div>
  )
}
