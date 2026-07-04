// lib/billing/tokenCrypto.ts
// Criptografia dos tokens OAuth das academias (AES-256-GCM). A chave vem de
// GATEWAY_TOKEN_KEY (64 chars hex = 32 bytes). Tokens NUNCA ficam em texto
// puro no banco nem chegam ao client.
import crypto from 'crypto'

function getKey(explicit?: string): Buffer {
  const hex = explicit ?? process.env.GATEWAY_TOKEN_KEY
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('GATEWAY_TOKEN_KEY ausente ou inválida (esperado: 64 chars hex = 32 bytes)')
  }
  return Buffer.from(hex, 'hex')
}

// Formato do payload: base64(iv).base64(authTag).base64(ciphertext)
export function encryptSecret(plain: string, key?: string): string {
  const k = getKey(key)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.')
}

export function decryptSecret(payload: string, key?: string): string {
  const k = getKey(key)
  const [ivB64, tagB64, dataB64] = payload.split('.')
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Payload criptografado malformado')
  const decipher = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}
