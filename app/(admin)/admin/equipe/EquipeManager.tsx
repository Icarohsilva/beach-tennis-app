// app/(admin)/admin/equipe/EquipeManager.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createProfessor, removeProfessor, setCoOwner } from '@/features/organizations/actions'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'

export interface ProfessorRow {
  id: string
  full_name: string
  is_co_owner: boolean
}

export function EquipeManager({ professors }: { professors: ProfessorRow[] }) {
  const router = useRouter()
  const [form, setForm] = useState({ fullName: '', email: '', password: '', phone: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await createProfessor(form)
    setLoading(false)
    if (res.error) { setError(res.error); return }
    setForm({ fullName: '', email: '', password: '', phone: '' })
    router.refresh()
  }

  async function handleRemove(id: string) {
    if (!confirm('Remover este professor? A conta dele será excluída.')) return
    const res = await removeProfessor(id)
    if (res.error) { alert(res.error); return }
    router.refresh()
  }

  async function handleToggleCoOwner(id: string, current: boolean) {
    const action = current ? 'remover' : 'tornar'
    if (!confirm(`Confirma ${action} este professor admin master? Admin master tem acesso total: financeiro, configurações e equipe.`)) return
    setTogglingId(id)
    const res = await setCoOwner(id, !current)
    setTogglingId(null)
    if (res.error) { alert(res.error); return }
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="text-white font-semibold mb-4">Adicionar professor</h2>
        <form onSubmit={handleCreate} className="flex flex-col gap-3">
          <Input label="Nome" value={form.fullName} onChange={set('fullName')} required />
          <Input label="Email" type="email" value={form.email} onChange={set('email')} required />
          <Input label="Telefone" type="tel" value={form.phone} onChange={set('phone')} placeholder="(11) 99999-9999" />
          <Input label="Senha provisória" type="password" value={form.password} onChange={set('password')} required minLength={6} />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" loading={loading} className="w-fit">Adicionar</Button>
        </form>
      </Card>

      <Card>
        <h2 className="text-white font-semibold mb-4">Professores</h2>
        {professors.length === 0 ? (
          <p className="text-slate-400 text-sm">Nenhum professor adicionado ainda.</p>
        ) : (
          <ul className="divide-y divide-surface-border">
            {professors.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-3 gap-3">
                <span className="text-white text-sm flex items-center gap-2">
                  {p.full_name}
                  {p.is_co_owner && <Badge variant="level">Admin master</Badge>}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleToggleCoOwner(p.id, p.is_co_owner)}
                    disabled={togglingId === p.id}
                    className="text-brand-500 hover:text-brand-400 text-sm disabled:opacity-50"
                  >
                    {p.is_co_owner ? 'Remover admin master' : 'Tornar admin master'}
                  </button>
                  <button
                    onClick={() => handleRemove(p.id)}
                    className="text-red-400 hover:text-red-300 text-sm"
                  >
                    Remover
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
