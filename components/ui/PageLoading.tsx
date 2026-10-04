// components/ui/PageLoading.tsx
// O que aparece NA HORA do clique, enquanto a página nova busca os dados.
//
// Sem isto o Next só troca de tela quando a página inteira está pronta: o
// admin clicava em um aluno, nada acontecia por alguns segundos e a ficha
// "abria do nada" — parecia que o clique não tinha pegado, e a pessoa clicava
// de novo. Cada página tem um loading.tsx que renderiza este componente, e o
// "Carregando…" escrito é de propósito: um esqueleto cinza sozinho não diz que
// o clique foi recebido.
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { Skeleton } from './Skeleton'

interface Props {
  /**
   * 'dashboard' = tela do aluno (as páginas trazem o próprio p-4 e a folga da
   * barra de baixo); 'panel' = admin e plataforma, cujo layout já tem margem.
   */
  variant?: 'dashboard' | 'panel'
  label?: string
}

export function PageLoading({ variant = 'dashboard', label = 'Carregando…' }: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('space-y-4', variant === 'dashboard' && 'p-4 pb-24')}
    >
      <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
        <Loader2 className="h-4 w-4 animate-spin text-brand-500" aria-hidden />
        {label}
      </div>
      <Skeleton className="h-24" />
      <Skeleton className="h-20" />
      <Skeleton className="h-20" />
      <Skeleton className="h-20" />
    </div>
  )
}
