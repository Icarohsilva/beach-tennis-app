// lib/aulas/calendarFeedUrl.ts
// A URL pública do feed .ics a partir do token — usada tanto pelas server
// actions que geram/renovam o token (features/perfil/calendarSyncActions.ts,
// que só pode exportar função assíncrona por ser 'use server') quanto pela
// página de perfil (Server Component), que monta a URL para o token já salvo
// sem precisar de mais uma ida ao servidor.
import { getSiteUrl } from '@/lib/utils/siteUrl'

export function calendarFeedUrl(token: string): string {
  return `${getSiteUrl()}/api/calendar/${token}`
}
