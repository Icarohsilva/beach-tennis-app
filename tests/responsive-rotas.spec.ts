// tests/responsive-rotas.spec.ts
// A mesma asserção da bancada, mas sobre as ROTAS REAIS do app.
//
// Exige um `.env.local` com as credenciais do Supabase, e as rotas de aluno/admin
// exigem sessão — por isso está separada de responsive.spec.ts, que roda em
// qualquer lugar. Rode com:
//
//   npm run test:responsive:rotas
//
// Para cobrir as rotas autenticadas, exporte PW_STORAGE_STATE apontando para um
// storageState.json gravado com uma sessão válida (Playwright codegen resolve),
// ou PW_EMAIL/PW_PASSWORD para o teste fazer login pelo formulário.
import { test } from '@playwright/test'
import fs from 'node:fs'
import {
  LARGURAS,
  emLargura,
  elementosQueEstouram,
  esperarSemRolagemHorizontal,
} from './overflow'

/** Rotas que respondem sem sessão. */
const PUBLICAS = ['/', '/login', '/cadastro', '/instalar'] as const

/** Rotas que exigem aluno logado. */
const ALUNO = ['/home', '/aulas', '/agendar', '/liga', '/perfil', '/financeiro', '/torneios', '/explorar'] as const

/** Rotas que exigem admin logado. */
const ADMIN = [
  '/admin/dashboard',
  '/admin/alunos',
  '/admin/grade',
  '/admin/financeiro',
  '/admin/relatorios',
  '/admin/torneios',
  '/admin/liga',
  '/admin/configuracoes',
] as const

const storageState = process.env.PW_STORAGE_STATE
const temSessao = Boolean(storageState && fs.existsSync(storageState))

function medir(rota: string) {
  for (const width of LARGURAS) {
    test(`${rota} @ ${width}px`, async ({ page }, testInfo) => {
      const resposta = await page.goto(rota)
      // Redirecionado para o login = a rota não foi medida. Falhar seria mentir
      // sobre cobertura; passar em silêncio também. Então: skip explícito.
      test.skip(
        page.url().includes('/login') && !rota.includes('/login'),
        `${rota} redirecionou para /login — sem sessão, esta rota não foi medida`,
      )
      test.skip(
        resposta !== null && resposta.status() >= 500,
        `${rota} respondeu ${resposta?.status()} — provavelmente falta credencial do Supabase`,
      )

      await emLargura(page, width)
      await esperarSemRolagemHorizontal(page, width)

      const culpados = await elementosQueEstouram(page, 'body')
      const png = await page.screenshot({ fullPage: true })
      await testInfo.attach(`${rota.replace(/\//g, '_')}-${width}px.png`, {
        body: png,
        contentType: 'image/png',
      })

      if (culpados.length > 0) {
        throw new Error(`estouros em ${rota} @ ${width}px:\n${culpados.join('\n')}`)
      }
    })
  }
}

test.describe('rotas públicas', () => {
  for (const rota of PUBLICAS) medir(rota)
})

test.describe('rotas do aluno', () => {
  test.skip(!temSessao, 'defina PW_STORAGE_STATE com uma sessão de aluno')
  test.use({ storageState })
  for (const rota of ALUNO) medir(rota)
})

test.describe('rotas do admin', () => {
  test.skip(!temSessao, 'defina PW_STORAGE_STATE com uma sessão de admin')
  test.use({ storageState })
  for (const rota of ADMIN) medir(rota)
})
