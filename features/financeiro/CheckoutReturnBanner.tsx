'use client'
// features/financeiro/CheckoutReturnBanner.tsx
// Aviso pós-retorno do checkout. O retorno é só informativo (efeitos vêm do
// webhook); aqui fazemos polling LEVE: router.refresh() a cada 5s por até 30s
// para a página refletir a ativação sem o aluno recarregar na mão.
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'

export function CheckoutReturnBanner({ message }: { message: string }) {
  const router = useRouter()
  const ticks = useRef(0)

  useEffect(() => {
    const interval = setInterval(() => {
      ticks.current += 1
      if (ticks.current > 6) {
        clearInterval(interval)
        return
      }
      router.refresh()
    }, 5000)
    return () => clearInterval(interval)
  }, [router])

  return (
    <Card>
      <p className="text-sm text-white">{message}</p>
    </Card>
  )
}
