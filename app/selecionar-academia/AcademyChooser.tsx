// app/selecionar-academia/AcademyChooser.tsx
'use client'
import { useState } from 'react'
import { setActiveOrg } from '@/features/organizations/setActiveOrg'
import { Card } from '@/components/ui/Card'

interface Option {
  organization_id: string
  org_name: string
  role: string
}

export function AcademyChooser({ options }: { options: Option[] }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function choose(orgId: string) {
    setBusy(orgId)
    setError('')
    const res = await setActiveOrg(orgId)
    if (res.error) {
      setError(res.error)
      setBusy(null)
      return
    }
    // Admin cai no painel; aluno na home. Navegação FORÇADA (hard nav), não
    // router.push(): o painel admin tem um redirect() dentro do layout (gate de
    // assinatura) que é conhecidamente não-confiável do Next.js em navegação
    // client-side — produz tela em branco até um reload manual. Hard nav sempre
    // completa a cadeia de redirect corretamente, igual a um F5.
    const role = options.find((o) => o.organization_id === orgId)?.role
    window.location.href = role === 'admin' ? '/admin/dashboard' : '/home'
  }

  return (
    <Card>
      <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
      <h2 className="text-lg font-semibold text-white mb-1">Escolha a academia</h2>
      <p className="text-slate-400 text-sm mb-6">Você participa de mais de uma academia.</p>
      <div className="flex flex-col gap-3">
        {options.map((o) => (
          <button
            key={o.organization_id}
            onClick={() => choose(o.organization_id)}
            disabled={busy !== null}
            className="w-full text-left px-4 py-3 rounded-xl bg-surface-card border border-surface-border hover:border-brand-500 transition-colors disabled:opacity-50"
          >
            <span className="block text-white font-medium">{o.org_name}</span>
            <span className="block text-xs text-slate-400">
              {o.role === 'admin' ? 'Administração' : 'Aluno'}
              {busy === o.organization_id ? ' · entrando…' : ''}
            </span>
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-400 mt-4">{error}</p>}
    </Card>
  )
}
