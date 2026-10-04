// lib/utils/compressImage.ts
// Reduz uma imagem NO NAVEGADOR antes de mandar para uma server action.
//
// Server action do Next aceita 1 MB por padrão (e a Vercel corta qualquer
// requisição acima de 4,5 MB); o print de um celular atual passa disso com
// folga. Redimensionar para 1600px no lado maior mantém o texto do print
// legível e deixa o arquivo em poucas centenas de KB. Se algo falhar (navegador
// antigo, formato estranho), devolve o arquivo original e o servidor decide.

export async function compressImage(
  file: File,
  opts: { maxSide?: number; quality?: number } = {},
): Promise<File> {
  const maxSide = opts.maxSide ?? 1600
  const quality = opts.quality ?? 0.82
  if (typeof window === 'undefined' || !file.type.startsWith('image/')) return file

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    )
    if (!blob) return file
    // Só troca se ficou menor: um PNG pequeno pode crescer ao virar JPEG.
    if (blob.size >= file.size) return file
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg' })
  } catch {
    return file
  }
}
