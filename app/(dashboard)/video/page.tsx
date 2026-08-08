// app/(dashboard)/video/page.tsx
// A aba Vídeo virou a Liga (spec 2026-08-02-liga-gamificacao-aluno); o vídeo é um
// bloco lá dentro. Mantido como redirect porque a URL circulou entre alunos.
import { redirect } from 'next/navigation'

export default function VideoPage() {
  redirect('/liga')
}
