// app/experimental/page.tsx
// Rota legada: a descoberta de aulas experimentais agora vive em /arenas (por região).
// Mantém links externos antigos funcionando.
import { redirect } from 'next/navigation'

export default function ExperimentalPage() {
  redirect('/arenas')
}
