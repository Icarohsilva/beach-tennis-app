'use client'
// features/financeiro/RecommendationBanner.tsx
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { dismissPlanRecommendation } from './recommendationActions'

interface RecommendationBannerProps {
  recommendationId: string
  planName: string
  periodicityLabel: string
  price: number
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
}

export function RecommendationBanner({
  recommendationId,
  planName,
  periodicityLabel,
  price,
}: RecommendationBannerProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleDismiss() {
    setError(null)
    startTransition(async () => {
      const result = await dismissPlanRecommendation(recommendationId)
      if (result.error) setError(result.error)
      else router.refresh()
    })
  }

  return (
    <div className="rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 p-4">
      <p className="text-white text-sm font-semibold">A academia indicou um plano para você</p>
      <p className="text-white/80 text-xs mt-1">
        {planName} · {periodicityLabel} · {formatCurrency(price)}
      </p>
      <div className="flex gap-2 mt-3">
        <Link
          href="/financeiro"
          className="inline-flex items-center rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-brand-700"
        >
          Ver e assinar
        </Link>
        <Button size="sm" variant="ghost" loading={pending} onClick={handleDismiss}>
          Agora não
        </Button>
      </div>
      {error && <p className="text-white/90 text-xs mt-2">{error}</p>}
    </div>
  )
}
