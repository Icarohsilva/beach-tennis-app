// app/(dashboard)/comunidade/page.tsx
// A comunidade virou uma seção da Liga (spec 2026-08-02-liga-gamificacao-aluno §Fase 3).
// Mantido como redirect porque a URL circulou entre alunos e está em prints antigos.
import { redirect } from 'next/navigation'

export default function ComunidadePage() {
  redirect('/liga')
}
