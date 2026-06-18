'use client'
// app/onboarding/OnboardingForm.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SPORTS } from '@/lib/arenas/sports'
import { formatCep, isCompleteCep, fetchAddressByCep } from '@/lib/arenas/cep'
import { completeOnboarding } from '@/features/organizations/actions'

interface OnboardingInitial {
  cep: string
  state: string
  city: string
  neighborhood: string
  address_line: string
  address_number: string
  no_number: boolean
  sports: string[]
  whatsapp: string
  is_listed: boolean
  description: string
  brand_color: string
}

export function OnboardingForm({ initial }: { initial: OnboardingInitial }) {
  const router = useRouter()
  const [cep, setCep] = useState(initial.cep)
  const [state, setState] = useState(initial.state)
  const [city, setCity] = useState(initial.city)
  const [neighborhood, setNeighborhood] = useState(initial.neighborhood)
  const [addressLine, setAddressLine] = useState(initial.address_line)
  const [addressNumber, setAddressNumber] = useState(initial.address_number)
  const [noNumber, setNoNumber] = useState(initial.no_number)
  const [sports, setSports] = useState<string[]>(initial.sports)
  const [whatsapp, setWhatsapp] = useState(initial.whatsapp)
  const [isListed, setIsListed] = useState(initial.is_listed)
  const [description, setDescription] = useState(initial.description)
  const [brandColor, setBrandColor] = useState(initial.brand_color)

  const [cepStatus, setCepStatus] = useState<'idle' | 'loading' | 'notfound'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function toggleSport(slug: string) {
    setSports((cur) => (cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug]))
  }

  async function handleCepChange(raw: string) {
    const masked = formatCep(raw)
    setCep(masked)
    setCepStatus('idle')
    if (isCompleteCep(masked)) {
      setCepStatus('loading')
      const addr = await fetchAddressByCep(masked)
      if (addr) {
        setState(addr.state)
        setCity(addr.city)
        setNeighborhood(addr.neighborhood)
        setAddressLine(addr.addressLine)
        setCepStatus('idle')
      } else {
        setCepStatus('notfound')
      }
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await completeOnboarding({
        cep,
        state,
        city,
        neighborhood,
        address_line: addressLine,
        address_number: addressNumber,
        no_number: noNumber,
        sports,
        whatsapp,
        is_listed: isListed,
        description,
        brand_color: brandColor,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      router.push('/admin/dashboard')
      router.refresh()
    })
  }

  return (
    <Card>
      <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
      <h1 className="text-lg font-semibold text-white mb-1">Onde fica sua academia?</h1>
      <p className="text-slate-400 text-sm mb-6">
        Preencha o endereço para sua arena aparecer no diretório e receber alunos.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div>
          <Input
            label="CEP"
            placeholder="00000-000"
            value={cep}
            onChange={(e) => handleCepChange(e.target.value)}
            inputMode="numeric"
          />
          {cepStatus === 'loading' && <p className="text-xs text-slate-400 mt-1">Buscando endereço…</p>}
          {cepStatus === 'notfound' && (
            <p className="text-xs text-yellow-400 mt-1">CEP não encontrado — preencha manualmente.</p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input label="Estado (UF)" placeholder="SP" maxLength={2} value={state} onChange={(e) => setState(e.target.value)} />
          <div className="sm:col-span-2">
            <Input label="Cidade" placeholder="São Paulo" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
        </div>

        <Input label="Bairro" placeholder="Pinheiros" value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} />
        <Input label="Rua / logradouro" placeholder="Rua das Quadras" value={addressLine} onChange={(e) => setAddressLine(e.target.value)} />

        {!noNumber && (
          <Input
            label="Número"
            placeholder="123"
            value={addressNumber}
            onChange={(e) => setAddressNumber(e.target.value)}
          />
        )}
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={noNumber}
            onChange={(e) => setNoNumber(e.target.checked)}
            className="w-4 h-4 accent-brand-500"
          />
          <span className="text-sm text-slate-200">Sem número</span>
        </label>

        <div className="space-y-2">
          <label className="text-sm text-slate-300 font-medium">Esportes oferecidos</label>
          <div className="flex flex-wrap gap-2">
            {SPORTS.map((sport) => {
              const active = sports.includes(sport.slug)
              return (
                <button
                  key={sport.slug}
                  type="button"
                  onClick={() => toggleSport(sport.slug)}
                  className={[
                    'text-sm rounded-full px-3 py-1.5 border transition-colors',
                    active
                      ? 'border-brand-500 bg-brand-500/15 text-white'
                      : 'border-surface-border bg-surface-card text-slate-400 hover:border-slate-500',
                  ].join(' ')}
                >
                  {sport.emoji} {sport.label}
                </button>
              )
            })}
          </div>
        </div>

        <Input label="WhatsApp" placeholder="(11) 99999-9999" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={isListed}
            onChange={(e) => setIsListed(e.target.checked)}
            className="w-4 h-4 accent-brand-500"
          />
          <span className="text-sm text-slate-200">Aparecer no diretório público de arenas</span>
        </label>

        <div className="border-t border-surface-border pt-4 mt-1">
          <h2 className="text-sm font-semibold text-white mb-3">Personalização (opcional)</h2>
          <div className="flex flex-col gap-3">
            <label className="text-sm text-slate-300">
              Descrição
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="mt-1 block w-full bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
              />
            </label>
            <label className="text-sm text-slate-300">
              Cor da marca
              <input
                type="color"
                value={brandColor || '#f97316'}
                onChange={(e) => setBrandColor(e.target.value)}
                className="mt-1 block h-9 w-16 bg-surface-card border border-surface-border rounded-lg"
              />
            </label>
          </div>
        </div>

        <Button type="submit" loading={pending} size="lg" className="w-full">
          Concluir e ir para o painel
        </Button>
      </form>
    </Card>
  )
}
