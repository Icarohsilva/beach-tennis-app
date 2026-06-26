// app/api/webhooks/wellhub/route.ts
// Webhook de check-in da Wellhub. runtime nodejs: precisa do corpo CRU para a
// assinatura. Roteia gym_id → academia via org_integrations e delega ao núcleo
// de ingestão. Sempre 200 para evento genuíno (mesmo órfão) para a Wellhub não
// reenviar. Segue o padrão do webhook do Mercado Pago.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { parseWellhubEvent, verifyWellhubSignature } from '@/lib/checkin/wellhub'
import { ingestPartnerCheckin } from '@/lib/checkin/ingest'

export const runtime = 'nodejs'

// Header de assinatura assumido (ajustar quando a doc real chegar — junto do parser).
const SIGNATURE_HEADER = 'x-wellhub-signature'

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  // 1. Parse do payload cru. Malformado → 400.
  let event
  try {
    event = parseWellhubEvent(rawBody)
  } catch {
    return NextResponse.json({ error: 'Malformed payload' }, { status: 400 })
  }

  const admin = createAdminClient()

  // 2. Roteia gym_id → academia. Gym desconhecido → 200 (nada a fazer).
  const { data: integration } = await admin
    .from('org_integrations')
    .select('organization_id, webhook_secret')
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

  // 4. Ingestão (casa aluno ou parqueia como pendente).
  await ingestPartnerCheckin(
    {
      orgId: integration.organization_id,
      partner: 'wellhub',
      partnerMemberId: event.partnerMemberId,
      date: event.checkinDate,
      externalRef: event.externalRef,
      payload: JSON.parse(rawBody),
    },
    admin,
  )

  // 5. Sempre 200 para evento genuíno.
  return NextResponse.json({ received: true })
}
