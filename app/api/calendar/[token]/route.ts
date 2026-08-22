// app/api/calendar/[token]/route.ts
// Feed .ics pessoal do aluno — o link que ele assina no Google/Outlook/Apple
// Calendar (features/perfil/CalendarSyncForm.tsx gera o link,
// features/perfil/calendarSyncActions.ts gera o token).
//
// Público de propósito: quem bate aqui é o app de calendário do aluno, não um
// navegador logado, e não tem como pedir login interativo para ele. A
// autenticação é o próprio token na URL — mesmo desenho dos webhooks
// (app/api/webhooks/*), que também se autenticam sozinhos porque `/api` já
// sai do gate de cookie do middleware (ver config.matcher em middleware.ts).
//
// force-dynamic: cada busca do app de calendário precisa do estado atual do
// banco, nunca de uma versão em cache do build.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getCalendarFeedEvents } from '@/features/aulas/calendarFeedQuery'
import { buildIcsCalendar } from '@/lib/aulas/icsFeed'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('memberships')
    .select('user_id, organization_id, calendar_sync_enabled, organizations(name)')
    .eq('calendar_feed_token', params.token)
    .maybeSingle()

  const row = membership as {
    user_id: string
    organization_id: string
    calendar_sync_enabled: boolean
    organizations: { name: string } | { name: string }[] | null
  } | null

  // Token inexistente e sincronização desligada respondem igual: um link
  // desligado não deve dar nenhuma pista de que já existiu um dia.
  if (!row || !row.calendar_sync_enabled) {
    return NextResponse.json({ error: 'Não encontrado.' }, { status: 404 })
  }

  const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations
  const events = await getCalendarFeedEvents(admin, {
    orgId: row.organization_id,
    studentId: row.user_id,
  })

  const ics = buildIcsCalendar(
    `Agenda ${org?.name ?? 'ArenaHub'}`,
    events,
    new Date().toISOString(),
  )

  return new NextResponse(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="agenda-arenahub.ics"',
      // 15min: reduz carga no banco a cada poll do app de calendário sem
      // atrapalhar — a atualização nunca foi prometida como instantânea.
      'Cache-Control': 'private, max-age=900',
    },
  })
}
