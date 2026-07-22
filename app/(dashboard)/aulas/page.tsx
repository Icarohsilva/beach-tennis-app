// app/(dashboard)/aulas/page.tsx
// A antiga aba "Aulas" deixou de existir: a agenda da semana agora vive na Home
// e a aba passou a ser a "Arena" (torneios + day use). Mantemos a rota como
// redirect para não quebrar atalhos/links antigos (inclusive revalidatePath).
import { redirect } from 'next/navigation'

export default function AulasPage() {
  redirect('/home')
}
