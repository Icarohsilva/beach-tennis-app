// app/onboarding/page.tsx
export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { requireOwner, getCurrentOrg } from '@/lib/supabase/server'
import { OnboardingForm } from './OnboardingForm'

export default async function OnboardingPage() {
  await requireOwner() // não-autenticado → /login; professor → /admin/dashboard
  const org = await getCurrentOrg()
  if (!org) redirect('/login')
  if (org.onboarding_completed) redirect('/admin/dashboard')

  return (
    <div className="min-h-screen bg-surface text-white flex items-start justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <OnboardingForm
          initial={{
            cep: org.cep ?? '',
            state: org.state ?? '',
            city: org.city ?? '',
            neighborhood: org.neighborhood ?? '',
            address_line: org.address_line ?? '',
            address_number: org.address_number ?? '',
            no_number: org.no_number ?? false,
            sports: org.sports ?? [],
            whatsapp: org.whatsapp ?? '',
            is_listed: org.is_listed ?? true,
            description: org.description ?? '',
            brand_color: org.brand_color ?? '',
          }}
        />
      </div>
    </div>
  )
}
