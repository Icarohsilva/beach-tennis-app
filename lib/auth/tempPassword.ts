// lib/auth/tempPassword.ts
// Senha temporária aleatória para alunos criados pelo admin. Charset sem caracteres
// ambíguos (I, l, 1, O, 0) para facilitar repassar verbalmente/por escrito.
import { randomInt } from 'crypto'

const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'

export function generateTempPassword(length = 10): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += CHARSET[randomInt(CHARSET.length)]
  }
  return out
}
