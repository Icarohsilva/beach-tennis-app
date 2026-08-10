// lib/arenas/instagram.ts
// Normalização do @ do Instagram da arena.
//
// O campo é preenchido por quem administra a quadra, não por quem escreve
// software: chega "@arena", "arena", "instagram.com/arena/",
// "https://www.instagram.com/arena?igsh=abc". Guardar o texto cru faria a página
// montar "instagram.com/https://instagram.com/arena". Aqui sobra só o handle.

/** Só o que o Instagram aceita num nome de usuário. */
const HANDLE_CHARS = /^[A-Za-z0-9._]+$/

/**
 * Devolve o handle limpo, ou null quando não sobrou nada aproveitável.
 *
 * Null (e não string vazia) porque é o que vai para a coluna: "sem Instagram" e
 * "Instagram vazio" têm de ser o mesmo estado.
 */
export function normalizeInstagram(input: string | null | undefined): string | null {
  const raw = (input ?? '').trim()
  if (!raw) return null

  // Tira esquema, host e o que vier depois do handle (query, barra, path).
  const withoutUrl = raw
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/^instagram\.com\//i, '')
    .replace(/^m\.instagram\.com\//i, '')

  const handle = withoutUrl.replace(/^@+/, '').split(/[/?#]/)[0].trim()
  if (!handle) return null
  // Se o que sobrou não é um handle válido, é mais honesto descartar do que
  // gravar lixo que a página vai transformar num link quebrado.
  if (!HANDLE_CHARS.test(handle)) return null
  // Limite do próprio Instagram.
  if (handle.length > 30) return null

  return handle
}

/** URL do perfil, ou null quando não há handle. */
export function instagramUrl(handle: string | null | undefined): string | null {
  const clean = normalizeInstagram(handle)
  return clean ? `https://instagram.com/${clean}` : null
}
