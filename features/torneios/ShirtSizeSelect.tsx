'use client'
// features/torneios/ShirtSizeSelect.tsx
// O seletor de tamanho, um só para os cinco lugares que perguntam: aluno
// logado, avulso do link público, conta criada na hora, parceiro aceitando
// convite e admin inscrevendo. Cinco cópias da mesma lista de opções é como
// uma delas fica sem o baby look e a planilha chega torta.
import { SHIRT_SIZES, SHIRT_SIZE_LABEL } from '@/lib/torneios/shirtSize'

const SELECT_CLS =
  'w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-500'

export function ShirtSizeSelect({
  value,
  onChange,
  label = 'Tamanho da camisa',
  name,
  id,
}: {
  value: string
  onChange: (value: string) => void
  label?: string
  name?: string
  id?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-300">
        {label}
      </label>
      <select
        id={id}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={SELECT_CLS}
        required
      >
        {/* Vazio como primeira opção, e não um tamanho já escolhido: "M"
            pré-selecionado vira o tamanho de quem não leu a pergunta, e a arena
            encomenda errado sem ninguém perceber. */}
        <option value="">Selecione…</option>
        {SHIRT_SIZES.map((s) => (
          <option key={s} value={s}>{SHIRT_SIZE_LABEL[s]}</option>
        ))}
      </select>
    </div>
  )
}
