// lib/checkin/selfCheckinDismissStorage.ts
// Guarda quais sessões o aluno já dispensou no popup de confirmação de
// presença. Mesmo espírito de lib/pwa/dismissStorage.ts: toda leitura/escrita
// é protegida, porque Safari em navegação privada lança exceção ao escrever, e
// um localStorage indisponível nunca pode derrubar a página.
//
// localStorage, e não sessionStorage: em PWA instalado o sessionStorage pode
// não sobreviver a uma reabertura do app, e o popup voltaria toda vez.

const STORAGE_KEY = 'arenahub-self-checkin-dismissed'

/** Além de 24h a dispensa não faz mais sentido — a janela da aula já fechou. */
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000

function readMap(now: number): Record<string, number> {
  let raw: string | null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return {}
  }
  if (!raw) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null) return {}

  const pruned: Record<string, number> = {}
  for (const [sessionId, at] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof at !== 'number' || !Number.isFinite(at)) continue
    // Relógio adiantado no aparelho esconderia o popup indefinidamente.
    if (at > now) continue
    if (now - at > PRUNE_AFTER_MS) continue
    pruned[sessionId] = at
  }
  return pruned
}

function writeMap(map: Record<string, number>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // Sem persistência, o popup volta na próxima montagem. Aceitável.
  }
}

export function isSelfCheckinDismissed(sessionId: string, now: number = Date.now()): boolean {
  return sessionId in readMap(now)
}

export function dismissSelfCheckin(sessionId: string, now: number = Date.now()): void {
  const map = readMap(now)
  map[sessionId] = now
  writeMap(map)
}
