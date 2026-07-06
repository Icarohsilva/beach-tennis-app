// lib/utils/siteUrl.ts
// Base URL do site para back_url/notification_url/redirect_uri do MercadoPago.
// Normaliza para URL absoluta válida: força https:// (se a env vier sem
// esquema, ex. "www.arenahub.website") e remove barra(s) final(is). Sem o
// https://, o MP recusa com "Invalid value for back_url, must be a valid URL".
export function getSiteUrl(): string {
  // "??" só cai no default para null/undefined — env var vazia ("") ou só
  // espaços passaria adiante e viraria "https:" (sem host). Tratamos como
  // ausente também.
  const raw = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://arenahub.website')
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  return withScheme.replace(/\/+$/, '')
}
