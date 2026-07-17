// app/api/webhooks/wellhub/route.ts
// Webhook de check-in da Wellhub. runtime nodejs: precisa do corpo CRU para a
// assinatura. Roteia gym_id → academia via org_integrations e delega ao núcleo
// de ingestão. Sempre 200 para evento genuíno (mesmo órfão) para a Wellhub não
// reenviar. Segue o padrão do webhook do Mercado Pago.
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { parseWellhubEvent, verifyWellhubSignature } from '@/lib/checkin/wellhub'
import { ingestPartnerCheckin } from '@/lib/checkin/ingest'
import type { WellhubEnvironment } from '@/lib/checkin/wellhubValidate'

export const runtime = 'nodejs'

// Header de assinatura do Access Control API (HMAC-SHA1 do corpo cru, hex maiúsculo).
const SIGNATURE_HEADER = 'x-gympass-signature'

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  // 1. Parse do payload cru. Malformado → 400.
  let event
  try {
    event = parseWellhubEvent(rawBody)
  } catch (e) {
    console.error('[webhook/wellhub] payload malformado', e)
    Sentry.captureException(e, { tags: { webhook: 'wellhub' } })
    return NextResponse.json({ error: 'Malformed payload' }, { status: 400 })
  }

  // Evento que não é check-in (ex.: booking) → 200, nada a fazer.
  if (event.kind !== 'checkin') {
    return NextResponse.json({ received: true })
  }

  const admin = createAdminClient()

  // 2. Roteia gym_id → academia. Gym desconhecido → 200 (nada a fazer).
  const { data: integration } = await admin
    .from('org_integrations')
    .select('organization_id, webhook_secret, api_key, environment')
    .eq('partner', 'wellhub')
    .eq('gym_id', event.gymId)
    .eq('status', 'connected')
    .maybeSingle()

  if (!integration) {
    console.warn('[webhook/wellhub] gym desconhecido:', event.gymId)
    return NextResponse.json({ received: true })
  }

  // 3. Verifica a assinatura. Inválida → 401.
  const signature = req.headers.get(SIGNATURE_HEADER) ?? ''
  if (!verifyWellhubSignature(rawBody, signature, integration.webhook_secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // 4. Ingestão (casa aluno ou parqueia como pendente). Com api_key, valida em seguida.
  try {
    await ingestPartnerCheckin(
      {
        orgId: integration.organization_id,
        partner: 'wellhub',
        partnerMemberId: event.partnerMemberId,
        date: event.checkinDate,
        // parseWellhubEvent não expõe o epoch cru do evento (só a data local
        // derivada dele), e não é escopo aqui reexpor esse campo — o instante
        // de recebimento do webhook é uma aproximação segura: a Wellhub entrega
        // quase em tempo real, e a janela de casamento é de ±1h.
        checkinAt: new Date().toISOString(),
        externalRef: event.externalRef,
        payload: JSON.parse(rawBody),
        validate: integration.api_key
          ? {
              apiKey: integration.api_key,
              gymId: event.gymId,
              environment: (integration.environment as WellhubEnvironment) ?? 'production',
            }
          : undefined,
      },
      admin,
    )
  } catch (e) {
    // Retry da Wellhub não resolve um bug nosso de ingestão — reporta e ainda
    // assim confirma recebimento (200) pra não entrar em loop de reenvio.
    console.error('[webhook/wellhub] falha ao ingerir check-in', e)
    Sentry.captureException(e, {
      tags: { webhook: 'wellhub' },
      extra: { gymId: event.gymId, orgId: integration.organization_id },
    })
  }

  // 5. Sempre 200 para evento genuíno.
  return NextResponse.json({ received: true })
}
