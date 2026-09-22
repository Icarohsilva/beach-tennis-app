'use client'
// features/torneios/ShirtFields.tsx
// Os campos de camisa, um só para os cinco lugares que perguntam: aluno logado,
// avulso do link público, parceiro aceitando convite, convite por WhatsApp e
// admin inscrevendo. Cinco cópias da mesma lista de opções é como uma delas
// fica sem o baby look e a planilha chega torta.
import { Input } from '@/components/ui/Input'
import {
  MAX_SHIRT_NAME,
  SHIRT_SIZES,
  SHIRT_SIZE_LABEL,
} from '@/lib/torneios/shirt'

const SELECT_CLS =
  'w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-500'

export function ShirtFields({
  size,
  onSize,
  name,
  onName,
  askName = false,
  label = 'Tamanho da camisa',
  nameLabel = 'Nome na camisa',
}: {
  size: string
  onSize: (value: string) => void
  /** Nome estampado. Ignorado quando `askName` é falso. */
  name?: string
  onName?: (value: string) => void
  /** A camisa é estampada (shirtConfig().name). */
  askName?: boolean
  label?: string
  nameLabel?: string
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-300">{label}</label>
        <select
          value={size}
          onChange={(e) => onSize(e.target.value)}
          className={SELECT_CLS}
          required
        >
          {/* Vazio como primeira opção, e não um tamanho já escolhido: "M"
              pré-selecionado vira o tamanho de quem não leu a pergunta, e a
              arena encomenda errado sem ninguém perceber. */}
          <option value="">Selecione…</option>
          {SHIRT_SIZES.map((s) => (
            <option key={s} value={s}>{SHIRT_SIZE_LABEL[s]}</option>
          ))}
        </select>
      </div>

      {askName && onName && (
        <div className="flex flex-col gap-1">
          <Input
            label={nameLabel}
            value={name ?? ''}
            onChange={(e) => onName(e.target.value)}
            maxLength={MAX_SHIRT_NAME}
            placeholder="Como quer ser chamado"
            required
          />
          {/* O limite é largura de ESTAMPA, não do banco. Dito antes de digitar,
              a pessoa escolhe o que cortar; dito depois, ela reescreve o nome. */}
          <p className="text-xs text-slate-500">
            Até {MAX_SHIRT_NAME} caracteres — o primeiro nome ou o apelido, que é o que cabe
            nas costas.
          </p>
        </div>
      )}
    </div>
  )
}
