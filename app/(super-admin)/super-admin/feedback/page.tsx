// app/(super-admin)/super-admin/feedback/page.tsx
import { createAdminClient } from '@/lib/supabase/server'
import { FeedbackList, type FeedbackRow } from './FeedbackList'

interface FeedbackQueryRow {
  id: string
  category: FeedbackRow['category']
  message: string
  image_path: string | null
  status: FeedbackRow['status']
  created_at: string
  organization_id: string | null
  user_id: string
  profiles: { full_name: string } | { full_name: string }[] | null
  organizations: { name: string } | { name: string }[] | null
}

export default async function FeedbackPage() {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('feedback')
    .select('id, category, message, image_path, status, created_at, organization_id, user_id, profiles!feedback_user_id_fkey(full_name), organizations(name)')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return <p className="text-sm text-red-400">Erro ao carregar feedbacks.</p>

  const rows: FeedbackRow[] = await Promise.all(
    ((data ?? []) as unknown as FeedbackQueryRow[]).map(async (f) => {
      let imageUrl: string | null = null
      if (f.image_path) {
        const { data: signed } = await admin.storage
          .from('feedback-images')
          .createSignedUrl(f.image_path, 60 * 60)
        imageUrl = signed?.signedUrl ?? null
      }
      const profile = Array.isArray(f.profiles) ? f.profiles[0] : f.profiles
      const organization = Array.isArray(f.organizations) ? f.organizations[0] : f.organizations
      return {
        id: f.id,
        category: f.category,
        message: f.message,
        status: f.status,
        createdAt: f.created_at,
        author: profile?.full_name ?? '—',
        orgName: organization?.name ?? '—',
        imageUrl,
      }
    }),
  )

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Feedback</h1>
        <p className="text-sm text-slate-400">{rows.length} recebidos</p>
      </div>
      <FeedbackList rows={rows} />
    </div>
  )
}
