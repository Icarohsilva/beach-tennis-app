'use client'
// app/(admin)/admin/configuracoes/VideoFeedUrlForm.tsx
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { updateSystemSettings } from '@/features/financeiro/actions'

interface Props {
  videoFeedUrl: string
}

export function VideoFeedUrlForm({ videoFeedUrl }: Props) {
  const [url, setUrl] = useState(videoFeedUrl)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    const trimmed = url.trim()
    if (trimmed !== '' && !/^https?:\/\//i.test(trimmed)) {
      setError('A URL deve começar com http:// ou https://.')
      return
    }

    startTransition(async () => {
      const result = await updateSystemSettings({ video_feed_url: trimmed })
      if (result.error) {
        setError(result.error)
      } else {
        setSuccess('URL do site de vídeos salva com sucesso.')
      }
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

        <div className="space-y-1">
          <label className="text-sm text-slate-300 font-medium">
            URL do site de vídeos/câmeras
          </label>
          <p className="text-xs text-slate-400">
            Cole o link da tela de login do sistema de câmeras. Os alunos verão essa página
            dentro do app, na aba Vídeo. Deixe em branco para ocultar essa aba do aluno.
          </p>
          <Input
            type="url"
            placeholder="https://..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>

        <Button type="submit" variant="primary" loading={pending}>
          Salvar URL de vídeos
        </Button>
      </form>
    </Card>
  )
}
