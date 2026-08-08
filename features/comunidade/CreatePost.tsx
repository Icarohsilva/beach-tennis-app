'use client'
// features/comunidade/CreatePost.tsx

import { useState, useRef, useTransition } from 'react'
import Image from 'next/image'
import { X, ImagePlus, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { createPost } from './actions'

type NewPost = { id: string; organization_id: string; author_id: string; content: string; image_urls: string[]; likes_count: number; is_pinned: boolean; session_id: string | null; tournament_id: string | null; created_at: string; author: { id: string; full_name: string; avatar_url: string | null } }

interface CreatePostProps {
  onClose: () => void
  onPostCreated?: (post: NewPost) => void
}

export function CreatePost({ onClose, onPostCreated }: CreatePostProps) {
  const [content, setContent] = useState('')
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return

    const totalImages = imageFiles.length + files.length
    if (totalImages > 4) {
      setError('Máximo de 4 imagens por post.')
      return
    }

    const newPreviews = files.map((file) => URL.createObjectURL(file))
    setImageFiles((prev) => [...prev, ...files])
    setImagePreviews((prev) => [...prev, ...newPreviews])
    setError(null)
    // Reset input so same file can be selected again
    e.target.value = ''
  }

  function removeImage(index: number) {
    URL.revokeObjectURL(imagePreviews[index])
    setImageFiles((prev) => prev.filter((_, i) => i !== index))
    setImagePreviews((prev) => prev.filter((_, i) => i !== index))
  }

  async function uploadImages(): Promise<string[]> {
    if (imageFiles.length === 0) return []

    const supabase = createClient()
    const uploadedUrls: string[] = []

    for (const file of imageFiles) {
      const ext = file.name.split('.').pop() ?? 'jpg'
      const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('post-images')
        .upload(path, file, { cacheControl: '3600', upsert: false })

      if (uploadError) throw new Error(`Erro ao enviar imagem: ${uploadError.message}`)

      const { data: urlData } = supabase.storage
        .from('post-images')
        .getPublicUrl(path)

      uploadedUrls.push(urlData.publicUrl)
    }

    return uploadedUrls
  }

  function handleSubmit() {
    if (!content.trim() && imageFiles.length === 0) {
      setError('Escreva algo ou adicione uma imagem.')
      return
    }
    setError(null)
    setUploading(true)

    startTransition(async () => {
      try {
        // Upload images BEFORE creating the post
        const imageUrls = await uploadImages()

        const result = await createPost({
          content,
          imageUrls,
        })

        if (result?.error || !result?.post) {
          setError(result?.error ?? 'Erro inesperado.')
          setUploading(false)
          return
        }

        setUploading(false)
        onPostCreated?.(result.post)
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro inesperado.')
        setUploading(false)
      }
    })
  }

  const isLoading = uploading || isPending

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <div className="bg-surface-card border border-surface-border rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
            <h2 className="text-white font-semibold">Novo post</h2>
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-surface-border transition-colors"
              aria-label="Fechar"
            >
              <X size={20} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="O que está acontecendo na sua academia? 🎾"
              rows={4}
              disabled={isLoading}
              className="w-full resize-none rounded-lg bg-surface border border-surface-border px-3 py-2 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent disabled:opacity-50 text-sm"
            />

            {/* Image previews */}
            {imagePreviews.length > 0 && (
              <div className={`grid gap-2 ${imagePreviews.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                {imagePreviews.map((preview, i) => (
                  <div key={preview} className="relative aspect-square rounded-lg overflow-hidden">
                    <Image
                      src={preview}
                      alt={`Preview ${i + 1}`}
                      fill
                      className="object-cover"
                    />
                    <button
                      onClick={() => removeImage(i)}
                      disabled={isLoading}
                      className="absolute top-1 right-1 bg-black/60 rounded-full p-0.5 text-white hover:bg-black/80 transition-colors disabled:opacity-50"
                      aria-label="Remover imagem"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {error && (
              <p className="text-red-400 text-sm">{error}</p>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-surface-border">
            <div className="flex items-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading || imageFiles.length >= 4}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-surface-border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Adicionar imagem"
              >
                <ImagePlus size={20} />
              </button>
              <span className="text-slate-500 text-xs">{imageFiles.length}/4</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>

            <Button
              onClick={handleSubmit}
              disabled={isLoading || (!content.trim() && imageFiles.length === 0)}
              loading={isLoading}
              size="sm"
            >
              {isLoading ? (uploading ? 'Enviando...' : 'Publicando...') : 'Publicar'}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
