'use client'
// app/(admin)/admin/configuracoes/BrandingForm.tsx
import { useState, useTransition } from 'react'
import Image from 'next/image'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ALLOWED_BRAND_COLORS, DEFAULT_BRAND_COLOR } from '@/lib/branding/palette'
import { accentVars } from '@/lib/branding/theme'
import { updateBranding } from '@/features/branding/actions'

interface BrandingFormProps {
  brandColor: string | null
  logoUrl: string | null
  orgName: string
}

export function BrandingForm({ brandColor, logoUrl, orgName }: BrandingFormProps) {
  const [color, setColor] = useState(brandColor ?? DEFAULT_BRAND_COLOR)
  const [logoPreview, setLogoPreview] = useState<string | null>(logoUrl)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) setLogoPreview(URL.createObjectURL(file))
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    const formData = new FormData(e.currentTarget)
    formData.set('brand_color', color)
    startTransition(async () => {
      const result = await updateBranding(formData)
      if (result.error) setError(result.error)
      else setSuccess('Personalização salva com sucesso.')
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

        {/* Logo */}
        <div className="space-y-2">
          <label className="text-sm text-slate-300 font-medium">Logo da academia</label>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-surface-border flex items-center justify-center overflow-hidden">
              {logoPreview ? (
                <Image src={logoPreview} alt="Prévia da logo" width={40} height={40} unoptimized className="object-contain" />
              ) : (
                <span className="text-xs text-slate-500">—</span>
              )}
            </div>
            <input
              type="file"
              name="logo"
              accept="image/png,image/svg+xml"
              onChange={handleFile}
              className="text-sm text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-surface-border file:px-3 file:py-1.5 file:text-sm file:text-white"
            />
          </div>
          <p className="text-xs text-slate-500">PNG ou SVG, até 512KB.</p>
        </div>

        {/* Seletor de cor */}
        <div className="space-y-2">
          <label className="text-sm text-slate-300 font-medium">Cor da academia</label>
          <div className="flex flex-wrap gap-2">
            {ALLOWED_BRAND_COLORS.map((c) => {
              const active = c.toLowerCase() === color.toLowerCase()
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Cor ${c}`}
                  aria-pressed={active}
                  className="w-8 h-8 rounded-lg transition-transform"
                  style={{
                    background: c,
                    outline: active ? '2px solid #fff' : 'none',
                    outlineOffset: '2px',
                  }}
                />
              )
            })}
          </div>
        </div>

        {/* Preview ao vivo */}
        <div className="space-y-2">
          <label className="text-sm text-slate-300 font-medium">Prévia</label>
          <div style={accentVars(color)} className="rounded-lg overflow-hidden border border-surface-border">
            <div className="bg-gradient-to-br from-brand-600 to-brand-800 px-4 py-3 flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-white/20 overflow-hidden flex items-center justify-center">
                {logoPreview && (
                  <Image src={logoPreview} alt="" aria-hidden width={20} height={20} unoptimized className="object-contain" />
                )}
              </div>
              <strong className="text-white text-sm truncate">{orgName}</strong>
            </div>
            <div className="bg-surface-card p-3">
              <button type="button" className="w-full bg-brand-500 text-white rounded-lg py-2 text-sm font-bold">
                Agendar aula
              </button>
              <span className="block mt-2 text-xs text-brand-500 font-semibold">● confirmada</span>
            </div>
          </div>
        </div>

        <Button type="submit" variant="primary" loading={pending}>
          Salvar personalização
        </Button>
      </form>
    </Card>
  )
}
