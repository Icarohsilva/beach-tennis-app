// components/ui/OrgSwitcher.tsx
'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setActiveOrg } from '@/features/organizations/setActiveOrg'

interface Item {
  organization_id: string
  org_name: string
}

// Mostra o nome da academia ativa; ao clicar, abre um menu para trocar de academia.
// Só deve ser renderizado quando há 2+ vínculos (decisão no layout).
export function OrgSwitcher({ items, activeOrgId }: { items: Item[]; activeOrgId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const active = items.find((i) => i.organization_id === activeOrgId)

  function switchTo(orgId: string) {
    setOpen(false)
    if (orgId === activeOrgId) return
    startTransition(async () => {
      await setActiveOrg(orgId)
      router.push('/home')
      router.refresh()
    })
  }

  return (
    <div className="relative max-w-[60%]">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        className="flex items-center gap-1 text-sm font-semibold text-white truncate disabled:opacity-50"
      >
        <span className="truncate">{active?.org_name ?? ''}</span>
        <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" className="shrink-0 text-slate-400">
          <path d="M5.5 7.5L10 12l4.5-4.5z" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-8 z-50 w-56 rounded-xl bg-surface-card border border-surface-border shadow-lg py-1">
            {items.map((i) => (
              <button
                key={i.organization_id}
                onClick={() => switchTo(i.organization_id)}
                className="block w-full text-left px-3 py-2 text-sm text-white hover:bg-surface-border/40 truncate"
              >
                {i.organization_id === activeOrgId ? '✓ ' : ''}{i.org_name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
