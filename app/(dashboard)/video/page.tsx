// app/(dashboard)/video/page.tsx
export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { VideoClient } from './VideoClient'

export default async function VideoPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()

  const { data: row } = await adminClient
    .from('system_settings')
    .select('value')
    .eq('organization_id', orgId)
    .eq('key', 'video_feed_url')
    .maybeSingle()

  return <VideoClient videoFeedUrl={row?.value ?? null} />
}
