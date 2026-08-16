// features/home/RulesCard.tsx
'use client'
import { useState } from 'react'
import { BookOpen } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import type { RuleSection } from '@/lib/aulas/classRules'
import { RulesModal } from './RulesModal'

/**
 * Card que abre o modal com todas as regras do sistema — mesmo recurso que a
 * Liga já tem para o ranking (features/liga/RulesCard.tsx), agora para o
 * dashboard. As seções chegam prontas do servidor (lib/aulas/classRules.ts);
 * este componente só guarda o estado de abertura.
 */
export function RulesCard({ sections }: { sections: RuleSection[] }) {
  const [open, setOpen] = useState(false)

  if (sections.length === 0) return null

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="block w-full text-left">
        <Card className="flex items-center gap-2.5 p-4">
          <BookOpen className="h-4 w-4 shrink-0 text-brand-500" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-white">Regras do sistema</span>
            <span className="block text-xs text-slate-400">
              Cancelamento, créditos, fila de espera, férias e mais. Toque para ver tudo.
            </span>
          </span>
        </Card>
      </button>

      {open && <RulesModal sections={sections} onClose={() => setOpen(false)} />}
    </>
  )
}
