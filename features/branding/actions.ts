'use server'
// features/branding/actions.ts
import { createAdminClient, requireOwner } from '@/lib/supabase/server'
import { isAllowedBrandColor } from '@/lib/branding/palette'

const MAX_LOGO_BYTES = 512 * 1024 // 512KB
const ALLOWED_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/svg+xml': 'svg',
}

export async function updateBranding(formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireOwner()
  const orgId = ctx.organizationId

  const brandColor = String(formData.get('brand_color') ?? '')
  if (!isAllowedBrandColor(brandColor)) {
    return { error: 'Cor inválida. Escolha uma das cores disponíveis.' }
  }

  const admin = createAdminClient()
  const update: { brand_color: string; logo_url?: string } = {
    brand_color: brandColor.toLowerCase(),
  }

  const file = formData.get('logo')
  if (file instanceof File && file.size > 0) {
    const ext = ALLOWED_TYPES[file.type]
    if (!ext) return { error: 'Logo deve ser PNG ou SVG.' }
    if (file.size > MAX_LOGO_BYTES) return { error: 'Logo deve ter no máximo 512KB.' }

    const path = `${orgId}/logo.${ext}`
    const { error: uploadErr } = await admin.storage
      .from('org-logos')
      .upload(path, file, { upsert: true, contentType: file.type })
    if (uploadErr) return { error: 'Erro ao enviar a logo. Tente novamente.' }

    const { data: pub } = admin.storage.from('org-logos').getPublicUrl(path)
    // cache-busting para refletir troca de logo (mesmo path, upsert)
    update.logo_url = `${pub.publicUrl}?v=${Date.now()}`
  }

  const { error: updateErr } = await admin
    .from('organizations')
    .update(update)
    .eq('id', orgId)
  if (updateErr) return { error: 'Erro ao salvar a personalização.' }

  const { revalidatePath } = await import('next/cache')
  revalidatePath('/admin/configuracoes')
  revalidatePath('/admin', 'layout')
  revalidatePath('/home')
  return {}
}
