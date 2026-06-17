// app/(admin)/admin/equipe/InviteCard.tsx
'use client'
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

export function InviteCard({ inviteUrl }: { inviteUrl: string }) {
  const [qr, setQr] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    QRCode.toDataURL(inviteUrl, { width: 200, margin: 1 }).then(setQr).catch(() => setQr(''))
  }, [inviteUrl])

  async function copy() {
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card>
      <h2 className="text-white font-semibold mb-1">Convidar alunos</h2>
      <p className="text-slate-400 text-sm mb-4">
        Compartilhe este link (ou o QR code) para os alunos entrarem na sua academia.
      </p>
      <div className="flex flex-col sm:flex-row gap-4 items-start">
        <div className="flex-1 w-full">
          <div className="bg-surface border border-surface-border rounded-xl px-3 py-2 text-sm text-slate-300 break-all">
            {inviteUrl}
          </div>
          <Button onClick={copy} size="sm" className="mt-3">
            {copied ? 'Copiado!' : 'Copiar link'}
          </Button>
        </div>
        {qr && (
          <img src={qr} alt="QR code de convite" className="rounded-xl border border-surface-border bg-white p-1" width={140} height={140} />
        )}
      </div>
    </Card>
  )
}
