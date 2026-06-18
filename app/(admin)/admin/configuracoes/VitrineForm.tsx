'use client'
// app/(admin)/admin/configuracoes/VitrineForm.tsx
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SPORTS } from '@/lib/arenas/sports'
import { formatCep, isCompleteCep, fetchAddressByCep } from '@/lib/arenas/cep'
import { updateOrgListing } from '@/features/financeiro/actions'

interface VitrineFormProps {
  listing: {
    is_listed: boolean
    cep: string
    state: string
    city: string
    neighborhood: string
    address_line: string
    address_number: string
    no_number: boolean
    sports: string[]
    whatsapp: string
  }
}

export function VitrineForm({ listing }: VitrineFormProps) {
  const [isListed, setIsListed] = useState(listing.is_listed)
  const [cep, setCep] = useState(listing.cep)
  const [addressNumber, setAddressNumber] = useState(listing.address_number)
  const [noNumber, setNoNumber] = useState(listing.no_number)
  const [cepStatus, setCepStatus] = useState<'idle' | 'loading' | 'notfound'>('idle')
  const [state, setState] = useState(listing.state)
  const [city, setCity] = useState(listing.city)
  const [neighborhood, setNeighborhood] = useState(listing.neighborhood)
  const [addressLine, setAddressLine] = useState(listing.address_line)
  const [sports, setSports] = useState<string[]>(listing.sports)
  const [whatsapp, setWhatsapp] = useState(listing.whatsapp)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
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
    setSuccess(null)
    startTransition(async () => {
      const result = await updateOrgListing({
        is_listed: isListed,
        cep,
        state,
        city,
        neighborhood,
        address_line: addressLine,
        address_number: addressNumber,
        no_number: noNumber,
        sports,
        whatsapp,
      })
      if (result.error) setError(result.error)
      else setSuccess('Vitrine salva com sucesso.')
    })
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        {success && (
          <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">
            {success}
          </p>
        )}

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={isListed}
            onChange={(e) => setIsListed(e.target.checked)}
            className="w-4 h-4 accent-brand-500"
          />
          <span className="text-sm text-slate-200 font-medium">
            Aparecer no diretório público de arenas
          </span>
        </label>

        {isListed && !city.trim() && (
          <p className="text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2">
            Preencha a cidade para a arena aparecer no diretório.
          </p>
        )}

        <div>
          <Input label="CEP" placeholder="00000-000" value={cep} onChange={(e) => handleCepChange(e.target.value)} inputMode="numeric" />
          {cepStatus === 'loading' && <p className="text-xs text-slate-400 mt-1">Buscando endereço…</p>}
          {cepStatus === 'notfound' && <p className="text-xs text-yellow-400 mt-1">CEP não encontrado — preencha manualmente.</p>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input label="Estado (UF)" placeholder="SP" maxLength={2} value={state} onChange={(e) => setState(e.target.value)} />
          <div className="sm:col-span-2">
            <Input label="Cidade" placeholder="São Paulo" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
        </div>

        <Input label="Bairro" placeholder="Pinheiros" value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} />
        <Input label="Endereço / referência" placeholder="Rua das Quadras, 123" value={addressLine} onChange={(e) => setAddressLine(e.target.value)} />
        {!noNumber && (
          <Input label="Número" placeholder="123" value={addressNumber} onChange={(e) => setAddressNumber(e.target.value)} />
        )}
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={noNumber} onChange={(e) => setNoNumber(e.target.checked)} className="w-4 h-4 accent-brand-500" />
          <span className="text-sm text-slate-200">Sem número</span>
        </label>
        <Input label="WhatsApp" placeholder="(11) 99999-9999" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />

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

        <Button type="submit" variant="primary" loading={pending}>
          Salvar vitrine
        </Button>
      </form>
    </Card>
  )
}
