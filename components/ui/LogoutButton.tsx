'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface Props {
  className?: string
  children?: React.ReactNode
}

export function LogoutButton({ className, children }: Props) {
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <button onClick={handleLogout} className={className}>
      {children ?? 'Sair'}
    </button>
  )
}
