// lib/org/identifiers.ts
// Gera slug e invite_code para novas academias. As versões "*Unique" garantem
// unicidade contra o banco (a coluna é UNIQUE; isso evita colisão antes do insert).
import type { SupabaseClient } from '@supabase/supabase-js'

export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // não-alfanumérico → hífen
    .replace(/^-+|-+$/g, '') // tira hífens das pontas
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export function generateInviteCode(length = 8): string {
  let code = ''
  for (let i = 0; i < length; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return code
}

async function slugTaken(db: SupabaseClient, slug: string): Promise<boolean> {
  const { data } = await db.from('organizations').select('id').eq('slug', slug).maybeSingle()
  return !!data
}

async function codeTaken(db: SupabaseClient, code: string): Promise<boolean> {
  const { data } = await db.from('organizations').select('id').eq('invite_code', code).maybeSingle()
  return !!data
}

// Slug único: usa o slugify; se tomado, adiciona sufixo aleatório curto.
export async function generateUniqueSlug(db: SupabaseClient, name: string): Promise<string> {
  const base = slugify(name) || 'academia'
  if (!(await slugTaken(db, base))) return base
  for (let i = 0; i < 10; i++) {
    const candidate = `${base}-${generateInviteCode(4).toLowerCase()}`
    if (!(await slugTaken(db, candidate))) return candidate
  }
  return `${base}-${Date.now()}`
}

// invite_code único: tenta gerar; em colisão (raríssima) tenta de novo.
export async function generateUniqueInviteCode(db: SupabaseClient): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = generateInviteCode()
    if (!(await codeTaken(db, code))) return code
  }
  throw new Error('Não foi possível gerar um código de convite único.')
}
