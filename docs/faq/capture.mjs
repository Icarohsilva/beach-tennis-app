// docs/faq/capture.mjs
// -----------------------------------------------------------------------------
// Script de automação Playwright que percorre os fluxos reais do ArenaHub
// (cadastro de academia -> painel admin -> criar aluno -> convite -> área do
// aluno) e salva screenshots em docs/faq/images/ para a documentação da FAQ.
//
// Uso:
//   1. Suba o app:      npm run dev        (localhost:3000)
//   2. Rode a captura:  node docs/faq/capture.mjs
//
// Variáveis de ambiente opcionais:
//   FAQ_BASE_URL   -> base do app (default http://localhost:3000)
//   FAQ_HEADFUL=1  -> abre o navegador visível (debug)
//
// O script gera dados de teste (CPF válido + e-mails únicos por timestamp), então
// cada execução cria uma academia nova. Prefixo "FAQ Demo" facilita a limpeza.
// -----------------------------------------------------------------------------
import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const IMAGES_DIR = join(__dirname, 'images')
mkdirSync(IMAGES_DIR, { recursive: true })

const BASE_URL = process.env.FAQ_BASE_URL ?? 'http://localhost:3000'
const HEADFUL = process.env.FAQ_HEADFUL === '1'
const ts = Date.now()

// Credenciais/dados gerados para esta execução ------------------------------
const academy = {
  name: `Arena FAQ Demo ${ts}`,
  fullName: 'Professor Demonstração',
  email: `faq.academia.${ts}@example.com`,
  password: 'senha123',
  document: genCPF(), // CPF válido (dígitos verificadores corretos)
  phone: '(11) 98888-7777',
}
const managedStudent = {
  fullName: 'Aluno Gerenciado Demo',
  email: `faq.aluno.gerenciado.${ts}@example.com`,
  tempPassword: '', // preenchido após criação no painel
}
const inviteStudent = {
  fullName: 'Aluna Convidada Demo',
  email: `faq.aluno.convite.${ts}@example.com`,
  password: 'senha123',
}
let inviteCode = ''

const results = [] // { name, ok, note }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function genCPF() {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 9))
  let d1 = 0
  for (let i = 0; i < 9; i++) d1 += n[i] * (10 - i)
  d1 = (d1 * 10) % 11
  if (d1 === 10) d1 = 0
  n.push(d1)
  let d2 = 0
  for (let i = 0; i < 10; i++) d2 += n[i] * (11 - i)
  d2 = (d2 * 10) % 11
  if (d2 === 10) d2 = 0
  n.push(d2)
  return n.join('')
}

async function shot(page, name) {
  const path = join(IMAGES_DIR, `${name}.png`)
  await page.screenshot({ path, fullPage: true })
  console.log(`  📸 ${name}.png`)
}

// Preenche um <Input> do design system localizando o <input> irmão do <label>.
// (No componente Input o label não usa htmlFor, então buscamos por posição.)
async function fillByLabel(scope, label, value) {
  const input = scope
    .locator(`xpath=//label[normalize-space()="${label}"]/following-sibling::input[1]`)
    .first()
  await input.waitFor({ state: 'visible', timeout: 15000 })
  await input.fill(value)
}

async function safe(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
  } catch (err) {
    console.error(`  ⚠️  ${name}: ${err.message.split('\n')[0]}`)
    results.push({ name, ok: false, note: err.message.split('\n')[0] })
  }
}

// Navega e tira print de páginas "estáticas" (só leitura).
async function capture(page, path, name, { wait = 1200 } = {}) {
  await safe(name, async () => {
    await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle', timeout: 45000 })
    await page.waitForTimeout(wait)
    await shot(page, name)
  })
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------
const browser = await chromium.launch({ headless: !HEADFUL })

// === PARTE 1 — ACADEMIA (desktop) =========================================
const adminCtx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'pt-BR',
})
const admin = await adminCtx.newPage()
admin.setDefaultTimeout(20000)
admin.on('pageerror', (e) => console.log('  [pageerror]', e.message.split('\n')[0]))

console.log('\n=== PARTE 1: ACADEMIA ===')

// Landing + login (páginas públicas)
await capture(admin, '/', 'landing')
await capture(admin, '/login', 'login')

// Cadastro da academia
await safe('criar-academia', async () => {
  await admin.goto(`${BASE_URL}/criar-academia`, { waitUntil: 'networkidle', timeout: 45000 })
  await admin.waitForTimeout(600)
  await shot(admin, 'criar-academia')

  await fillByLabel(admin, 'Nome da academia', academy.name)
  await fillByLabel(admin, 'Seu nome', academy.fullName)
  await fillByLabel(admin, 'Email', academy.email)
  await fillByLabel(admin, 'CPF ou CNPJ', academy.document)
  await fillByLabel(admin, 'Telefone', academy.phone)
  await fillByLabel(admin, 'Senha', academy.password)
  await admin.waitForTimeout(300)
  await shot(admin, 'criar-academia-preenchido')

  await admin.getByRole('button', { name: 'Criar academia' }).click()
  await admin.waitForURL('**/onboarding', { timeout: 45000 })
})

// Onboarding obrigatório (endereço + esportes)
await safe('onboarding', async () => {
  await admin.waitForTimeout(800)
  await shot(admin, 'onboarding')

  await fillByLabel(admin, 'CEP', '01310-100')
  await admin.waitForTimeout(2500) // autofill ViaCEP
  // Reforça campos caso o ViaCEP não responda:
  await fillByLabel(admin, 'Estado (UF)', 'SP').catch(() => {})
  await fillByLabel(admin, 'Cidade', 'São Paulo').catch(() => {})
  await fillByLabel(admin, 'Bairro', 'Bela Vista').catch(() => {})
  await fillByLabel(admin, 'Rua / logradouro', 'Av. Paulista').catch(() => {})
  await fillByLabel(admin, 'Número', '1000').catch(() => {})
  await admin.getByRole('button', { name: /Beach Tennis/i }).first().click().catch(() => {})
  await fillByLabel(admin, 'WhatsApp', '(11) 98888-7777').catch(() => {})
  await admin.waitForTimeout(300)
  await shot(admin, 'onboarding-preenchido')

  await admin.getByRole('button', { name: /Concluir e ir para o painel/i }).click()
  await admin.waitForURL('**/admin/dashboard', { timeout: 45000 })
  await admin.waitForTimeout(1200)
})

// Painel — Dashboard
await capture(admin, '/admin/dashboard', 'admin-dashboard')

// Alunos (vazio) + criar aluno pelo painel
await safe('admin-alunos-e-criar', async () => {
  await admin.goto(`${BASE_URL}/admin/alunos`, { waitUntil: 'networkidle', timeout: 45000 })
  await admin.waitForTimeout(800)
  await shot(admin, 'admin-alunos-vazio')

  await admin.getByRole('button', { name: 'Criar aluno' }).click()
  await admin.waitForTimeout(400)
  await fillByLabel(admin, 'Nome completo', managedStudent.fullName)
  await fillByLabel(admin, 'E-mail', managedStudent.email)
  await admin.waitForTimeout(300)
  await shot(admin, 'admin-criar-aluno-modal')

  await admin.getByRole('button', { name: 'Criar', exact: true }).click()
  // Modal de sucesso mostra a senha temporária
  const senhaEl = admin.locator('p.font-mono').first()
  await senhaEl.waitFor({ state: 'visible', timeout: 20000 })
  managedStudent.tempPassword = (await senhaEl.textContent())?.trim() ?? ''
  console.log(`  🔑 senha temporária do aluno: ${managedStudent.tempPassword}`)
  await shot(admin, 'admin-criar-aluno-senha')

  await admin.getByRole('button', { name: 'Fechar' }).click().catch(() => {})
  await admin.waitForTimeout(800)
  await admin.reload({ waitUntil: 'networkidle' })
  await admin.waitForTimeout(600)
  await shot(admin, 'admin-alunos-lista')
})

// Grade de aulas
await capture(admin, '/admin/grade', 'admin-grade')
await capture(admin, '/admin/relatorios', 'admin-relatorios')
await capture(admin, '/admin/grade/nova-turma', 'admin-grade-nova-turma')

// Financeiro
await capture(admin, '/admin/financeiro', 'admin-financeiro')
await capture(admin, '/admin/financeiro/planos', 'admin-financeiro-planos')
await capture(admin, '/admin/financeiro/integracoes', 'admin-financeiro-integracoes')

// Integrações de check-in (Wellhub / TotalPass)
await capture(admin, '/admin/integracoes', 'admin-integracoes')

// Configurações
await capture(admin, '/admin/configuracoes', 'admin-configuracoes')

// Equipe / convite — captura o print E extrai o invite_code
await safe('admin-equipe', async () => {
  await admin.goto(`${BASE_URL}/admin/equipe`, { waitUntil: 'networkidle', timeout: 45000 })
  await admin.waitForTimeout(1000)
  await shot(admin, 'admin-equipe')
  const bodyText = await admin.locator('body').innerText()
  const m = bodyText.match(/convite=([A-Za-z0-9]+)/)
  if (m) {
    inviteCode = m[1]
    console.log(`  🔗 invite_code: ${inviteCode}`)
  } else {
    throw new Error('invite_code não encontrado na página de equipe')
  }
})

// Demais áreas do painel
await capture(admin, '/admin/torneios', 'admin-torneios')
await capture(admin, '/admin/notificacoes', 'admin-notificacoes')
await capture(admin, '/admin/assinatura', 'admin-assinatura')

await adminCtx.close()

// === PARTE 2 — ALUNO GERENCIADO (1º login: trocar senha) ==================
console.log('\n=== PARTE 2: ALUNO GERENCIADO (definir senha) ===')
if (managedStudent.tempPassword) {
  const stuMgrCtx = await browser.newContext({
    viewport: { width: 414, height: 896 },
    locale: 'pt-BR',
    isMobile: true,
    hasTouch: true,
  })
  const p = await stuMgrCtx.newPage()
  p.setDefaultTimeout(20000)
  await safe('aluno-gerenciado-definir-senha', async () => {
    await p.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 45000 })
    await fillByLabel(p, 'Email', managedStudent.email)
    await fillByLabel(p, 'Senha', managedStudent.tempPassword)
    await p.getByRole('button', { name: 'Entrar' }).click()
    await p.waitForURL('**/definir-senha', { timeout: 45000 })
    await p.waitForTimeout(1000)
    await shot(p, 'aluno-gerenciado-definir-senha')
  })
  await stuMgrCtx.close()
}

// === PARTE 3 — ALUNO VIA CONVITE (mobile) =================================
console.log('\n=== PARTE 3: ALUNO VIA CONVITE ===')
const stuCtx = await browser.newContext({
  viewport: { width: 414, height: 896 },
  locale: 'pt-BR',
  isMobile: true,
  hasTouch: true,
})
const stu = await stuCtx.newPage()
stu.setDefaultTimeout(20000)
stu.on('pageerror', (e) => console.log('  [pageerror]', e.message.split('\n')[0]))

await safe('convite', async () => {
  if (!inviteCode) throw new Error('sem invite_code — pulando fluxo do aluno')
  await stu.goto(`${BASE_URL}/cadastro?convite=${inviteCode}`, {
    waitUntil: 'networkidle',
    timeout: 45000,
  })
  await stu.waitForTimeout(1500)
  await shot(stu, 'convite-escolha')

  await stu.getByRole('button', { name: /primeira vez/i }).click()
  await stu.waitForTimeout(800)
  await fillByLabel(stu, 'Nome completo', inviteStudent.fullName)
  await fillByLabel(stu, 'Email', inviteStudent.email)
  await fillByLabel(stu, 'Telefone', '(11) 97777-6666').catch(() => {})
  await fillByLabel(stu, 'Senha', inviteStudent.password)
  await stu.waitForTimeout(300)
  await shot(stu, 'convite-form')

  await stu.getByRole('button', { name: 'Criar conta' }).click()
  await stu.waitForURL('**/home', { timeout: 45000 })
  await stu.waitForTimeout(1500)
})

// Área do aluno
await safe('aluno-home', async () => {
  if (!stu.url().includes('/home')) await stu.goto(`${BASE_URL}/home`, { waitUntil: 'networkidle' })
  await stu.waitForTimeout(1000)
  await shot(stu, 'aluno-home')
})
await capture(stu, '/agendar', 'aluno-agendar')
await capture(stu, '/agendar/dayuse', 'aluno-agendar-dayuse')
await capture(stu, '/financeiro', 'aluno-financeiro')
await capture(stu, '/comunidade', 'aluno-comunidade')
// Aba "Arena": reúne torneios e day use (a antiga aba "Aulas" deixou de existir;
// a agenda de aulas passou para a Home).
await capture(stu, '/torneios', 'aluno-arena')
await capture(stu, '/perfil', 'aluno-perfil')

// --- Popup de instalação (só aparece em celular) ---------------------------
// Um contexto não muda de viewport/UA depois de criado, então clonamos a sessão
// do aluno num contexto "iPhone". shot() usa fullPage, que distorce overlays
// fixos — aqui o screenshot é direto, sem fullPage.
await safe('instalar-sheet-ios', async () => {
  const mobileCtx = await browser.newContext({
    viewport: { width: 390, height: 780 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    storageState: await stuCtx.storageState(),
  })
  const mob = await mobileCtx.newPage()
  await mob.goto(`${BASE_URL}/home`)
  await mob.getByRole('button', { name: 'Ver como faz' }).waitFor({ timeout: 15000 })
  await mob.screenshot({ path: join(IMAGES_DIR, 'instalar-sheet-ios.png') })
  console.log('  📸 instalar-sheet-ios.png')

  // Com os passos abertos: a animação e a lista numerada.
  await mob.getByRole('button', { name: 'Ver como faz' }).click()
  await mob.waitForTimeout(1000)
  await mob.screenshot({ path: join(IMAGES_DIR, 'instalar-passos-ios.png') })
  console.log('  📸 instalar-passos-ios.png')

  await mobileCtx.close()
})

await stuCtx.close()
await browser.close()

// ---------------------------------------------------------------------------
// Relatório + manifesto (usado ao escrever os .md)
// ---------------------------------------------------------------------------
const ok = results.filter((r) => r.ok).length
console.log(`\n=== RESUMO: ${ok}/${results.length} etapas OK ===`)
for (const r of results) if (!r.ok) console.log(`  ❌ ${r.name}: ${r.note}`)

writeFileSync(
  join(__dirname, 'capture-manifest.json'),
  JSON.stringify(
    { generatedAt: new Date().toISOString(), academy, managedStudent, inviteStudent, inviteCode, results },
    null,
    2,
  ),
)
console.log('\nManifesto salvo em docs/faq/capture-manifest.json')
