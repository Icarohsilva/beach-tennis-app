// app/(admin)/notificacoes/page.tsx
import { NotificacoesClient } from './NotificacoesClient'
import { requirePlatformAccess } from '@/lib/billing/guard'

export default async function NotificacoesPage() {
  await requirePlatformAccess() // gate de cobranca; ver lib/billing/guard.ts
  return <NotificacoesClient />
}
