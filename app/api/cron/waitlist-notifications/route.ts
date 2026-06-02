import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { offerWaitlistSpot } from '@/features/aulas/waitlistActions'

export async function GET(req: NextRequest) {
  // Verify Vercel cron secret
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminClient = createAdminClient()

  // Find 'offered' entries older than 1 hour
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  const { data: expired, error } = await adminClient
    .from('waitlists')
    .select('id, session_id')
    .eq('status', 'offered')
    .lt('notified_at', cutoff)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let processed = 0
  for (const entry of expired ?? []) {
    // Expire the current offered entry
    await adminClient
      .from('waitlists')
      .update({ status: 'expired' })
      .eq('id', entry.id)

    // Offer to next in queue
    await offerWaitlistSpot(entry.session_id)
    processed++
  }

  return NextResponse.json({ processed })
}
