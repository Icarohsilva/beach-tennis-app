// lib/pwa/dismissStorage.ts
// Guarda quando a pessoa dispensou o popup de instalação. A janela de 24h é
// aplicada em promptState — aqui só há IO e validação.

export const DISMISS_KEY = 'arenahub-install-dismissed-at'

// Toda leitura/escrita é protegida: Safari em navegação privada lança exceção
// ao escrever, e um localStorage indisponível nunca pode derrubar a página.
export function readDismissedAt(now: number = Date.now()): number | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(DISMISS_KEY)
  } catch {
    return null
  }
  if (!raw) return null

  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return null
  // Relógio adiantado no aparelho esconderia o popup indefinidamente.
  if (parsed > now) return null
  return parsed
}

export function writeDismissedAt(at: number = Date.now()): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(at))
  } catch {
    // Sem persistência, o popup volta na próxima navegação. Aceitável.
  }
}
