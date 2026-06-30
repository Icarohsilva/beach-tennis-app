'use client'
// app/(public)/t/[id]/ShareButton.tsx
import { useState } from 'react'

export function ShareButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  function handleShare() {
    if (navigator.share) {
      navigator.share({ url }).catch(() => {})
    } else {
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
    }
  }

  return (
    <button
      onClick={handleShare}
      className="absolute top-3 right-3 bg-black/50 text-white text-xs rounded-full px-3 py-1 flex items-center gap-1.5 hover:bg-black/70 transition-colors"
    >
      🔗 {copied ? 'Copiado!' : 'Compartilhar'}
    </button>
  )
}
