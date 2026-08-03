'use client'
// app/(admin)/admin/configuracoes/SelfCheckinForm.tsx
// Ponto da quadra + raio usados para conferir a confirmação de presença do aluno.
// O ViaCEP não devolve coordenadas, então o caminho prático é o dono abrir esta
// tela NA academia e capturar a própria posição.

import { useState, useTransition } from 'react'
import { MapPin } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Checkbox } from '@/components/ui/Checkbox'
import { updateOrgSelfCheckin } from '@/features/financeiro/actions'
import { DEFAULT_CHECKIN_RADIUS_M } from '@/lib/checkin/selfCheckin'

interface Props {
  settings: {
    enabled: boolean
    latitude: number | null
    longitude: number | null
    radiusM: number
  }
}

export function SelfCheckinForm({ settings }: Props) {
  const [enabled, setEnabled] = useState(settings.enabled)
  const [latitude, setLatitude] = useState(settings.latitude?.toString() ?? '')
  const [longitude, setLongitude] = useState(settings.longitude?.toString() ?? '')
  const [radius, setRadius] = useState(String(settings.radiusM || DEFAULT_CHECKIN_RADIUS_M))
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const [pending, startTransition] = useTransition()

  function handleUseCurrentPosition() {
    setError(null)
    setSuccess(null)

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Este navegador não informa a localização. Preencha à mão.')
      return
    }

    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        setLatitude(pos.coords.latitude.toFixed(6))
        setLongitude(pos.coords.longitude.toFixed(6))
        setSuccess(
          `Localização capturada (precisão de ${Math.round(pos.coords.accuracy)} m). Salve para aplicar.`,
        )
      },
      (err) => {
        setLocating(false)
        setError(
          err.code === err.PERMISSION_DENIED
            ? 'Permissão de localização negada pelo navegador.'
            : 'Não foi possível obter a localização. Preencha à mão.',
        )
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    )
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    const lat = latitude.trim() === '' ? null : Number(latitude.replace(',', '.'))
    const lng = longitude.trim() === '' ? null : Number(longitude.replace(',', '.'))
    const radiusM = Number(radius)

    if ((lat === null) !== (lng === null)) {
      setError('Informe latitude e longitude juntas.')
      return
    }
    if (lat !== null && (!Number.isFinite(lat) || !Number.isFinite(lng as number))) {
      setError('Coordenadas inválidas.')
      return
    }
    if (!Number.isInteger(radiusM) || radiusM < 20 || radiusM > 5000) {
      setError('O raio deve ficar entre 20 e 5000 metros.')
      return
    }

    startTransition(async () => {
      const result = await updateOrgSelfCheckin({ enabled, latitude: lat, longitude: lng, radiusM })
      if (result.error) setError(result.error)
      else setSuccess('Confirmação de presença salva.')
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

        <Checkbox
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          label={
            <span className="text-sm text-slate-300">
              Deixar o aluno confirmar presença pelo app
            </span>
          }
        />
        <p className="text-xs text-slate-400 -mt-2">
          A confirmação abre 1h antes do início da aula e fecha 1h depois do fim. Dentro do raio,
          a presença vale na hora; fora dele ou sem GPS, ela aparece na chamada para você aprovar.
          Aluno de parceiro segue com o check-in do Wellhub/TotalPass.
        </p>

        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={locating}
            onClick={handleUseCurrentPosition}
          >
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4" />
              Usar minha localização atual
            </span>
          </Button>
          <p className="mt-1.5 text-xs text-slate-400">
            Abra esta tela na quadra para marcar o ponto certo.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Latitude"
            inputMode="decimal"
            placeholder="-22.971964"
            value={latitude}
            onChange={(e) => setLatitude(e.target.value)}
          />
          <Input
            label="Longitude"
            inputMode="decimal"
            placeholder="-43.182543"
            value={longitude}
            onChange={(e) => setLongitude(e.target.value)}
          />
        </div>

        <Input
          label="Raio aceito (metros)"
          type="number"
          min={20}
          max={5000}
          value={radius}
          onChange={(e) => setRadius(e.target.value)}
        />
        <p className="text-xs text-slate-400 -mt-2">
          150 m cobre uma arena típica. Some a imprecisão do GPS do celular do aluno, que já é
          considerada automaticamente até 100 m.
        </p>

        <Button type="submit" variant="primary" loading={pending}>
          Salvar confirmação de presença
        </Button>
      </form>
    </Card>
  )
}
