'use server'
// features/feedback/actions.ts
import { randomUUID } from 'crypto'
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5MB
const IMG_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
const CATEGORIES = ['bug', 'elogio', 'ideia'] as const
type Category = (typeof CATEGORIES)[number]

export async function submitFeedback(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Faça login para enviar feedback.' }

  const category = String(formData.get('category') ?? '') as Category
  if (!CATEGORIES.includes(category)) {
    return { ok: false, error: 'Categoria inválida.' }
  }

  const message = String(formData.get('message') ?? '').trim()
  if (message.length < 5) {
    return { ok: false, error: 'Descreva com pelo menos 5 caracteres.' }
  }

  const admin = createAdminClient()
  let imagePath: string | null = null

  const file = formData.get('image')
  if (file instanceof File && file.size > 0) {
    const ext = IMG_EXT[file.type]
    if (!ext) return { ok: false, error: 'Imagem deve ser JPG, PNG ou WEBP.' }
    if (file.size > MAX_IMAGE_BYTES) {
      return { ok: false, error: 'Imagem deve ter no máximo 5MB.' }
    }
    const path = `${user.id}/${randomUUID()}.${ext}`
    const { error: upErr } = await admin.storage
      .from('feedback-images')
      .upload(path, file, { contentType: file.type })
    if (upErr) return { ok: false, error: 'Erro ao enviar a imagem. Tente novamente.' }
    imagePath = path
  }

  const organizationId = await getActiveOrgId()

  const { error: insErr } = await admin.from('feedback').insert({
    user_id: user.id,
    organization_id: organizationId,
    category,
    message,
    image_path: imagePath,
  })
  if (insErr) return { ok: false, error: 'Erro ao salvar. Tente novamente.' }

  return { ok: true }
}

export async function setFeedbackStatus(
  id: string,
  status: 'novo' | 'lido' | 'resolvido',
): Promise<{ ok: boolean }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false }

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single()
  if (profile?.is_platform_admin !== true) return { ok: false }

  const { error } = await admin.from('feedback').update({ status }).eq('id', id)
  return { ok: !error }
}
