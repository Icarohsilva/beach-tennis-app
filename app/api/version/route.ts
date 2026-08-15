// app/api/version/route.ts
// Qual build está no ar agora. O cliente compara com a build que ele mesmo carregou
// (lib/version.ts) para saber se saiu deploy novo.
//
// `/api` está fora do matcher do middleware (ver middleware.ts), então esta rota não
// passa por gate de sessão — é o desejado: quem precisa saber que há versão nova pode
// estar deslogado, e a resposta não expõe nada além de um identificador de build.
import { NextResponse } from 'next/server'
import { APP_BUILD_ID, SESSION_EPOCH } from '@/lib/version'

// force-dynamic + no-store: uma resposta cacheada pela CDN devolveria a build antiga
// para sempre e o mecanismo inteiro nunca dispararia.
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(
    { buildId: APP_BUILD_ID, sessionEpoch: SESSION_EPOCH },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
}
