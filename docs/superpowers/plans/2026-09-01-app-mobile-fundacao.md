# App mobile — Fundação e primeira publicação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar o ArenaHub na Play Store como app Android Expo que já abre todas as telas atuais logadas, com push nativo, e com o teste fechado dos 12 testadores em andamento.

**Architecture:** O repositório vira npm workspace com o Next.js permanecendo na raiz e um app Expo em `mobile/`. O app autentica direto no Supabase, guarda a sessão cifrada no dispositivo e troca os tokens por cookies `sb-*` numa rota nova (`/api/auth/sessao-nativa`); com esses cookies, as telas web rodam logadas dentro de WebViews nativas. Nenhuma tela de produto é reescrita nesta fase — a fundação é o entregável.

**Tech Stack:** Expo (SDK atual) · Expo Router · react-native-webview · @supabase/supabase-js · expo-secure-store + AsyncStorage (LargeSecureStore) · expo-notifications sobre FCM · EAS Build · Next.js 14 (backend, inalterado) · Vitest

**Spec:** [2026-09-01-app-mobile-nativo-design.md](../specs/2026-09-01-app-mobile-nativo-design.md)

---

## Antes de começar

**Rodar os testes pelo PowerShell, não pelo Bash.** `npm run test:run` pelo Bash falha aleatoriamente neste ambiente com `Cannot read properties of undefined (reading 'config')`. É flake de ambiente, não regressão.

**Baseline atual da suíte: 692 testes.** Depois das 21h (BRT) um teste de fuso em `missedCheckins.test.ts` falha e a baseline vira 691. Isso é conhecido — não investigue.

**Nenhuma migration é aplicada por CLI.** O `supabase db push` não tem auth nesta máquina. Migrations vão para `supabase/migrations/` e o **usuário** aplica pelo SQL Editor. Tarefas com migration terminam pedindo isso explicitamente.

**Dois desvios deliberados da spec, já decididos:**

1. A spec (decisão 6) diz que `packages/dominio` "nasce vazio". Este plano **não cria o pacote**: sub-projeto 1 não tem tela nativa de produto, logo não tem consumidor. O `workspaces` já lista `packages/*`, então criar o pacote no sub-projeto 3 não custa nada. Pacote vazio é peso morto.
2. O `url` de deep-link entra em `notifyUsers` como parâmetro **opcional** e nenhum dos ~20 chamadores é alterado nesta fase. Eles adotam quando cada domínio for migrado.
3. A spec lista `expo-network` para a tela de "sem conexão". Este plano **não instala o pacote**: `onError` e `onHttpError` da própria WebView já detectam a falha, e uma dependência a mais no build significa uma a mais para manter. Se a detecção pela WebView se mostrar insuficiente no teste fechado, aí sim entra o `expo-network`.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `package.json` (raiz) | Ganha `workspaces`. O web continua na raiz |
| `app/api/auth/sessao-nativa/route.ts` | **Única** superfície nova de autenticação: troca token por cookie |
| `app/api/auth/sessao-nativa/route.test.ts` | Testes dela |
| `lib/notifications/pushFcm.ts` | Envio FCM isolado — I/O puro, mesmo contrato do `push.ts` de hoje |
| `lib/notifications/dispatch.ts` | Escolhe o transporte por linha (`provider`) e repassa `url` |
| `lib/app/dentroDoApp.ts` | `isAppUserAgent()` — a pergunta "veio de dentro do app?", respondida no servidor |
| `app/(admin)/admin/assinatura/page.tsx` | Sem fluxo de compra dentro do app (política do Play) |
| `supabase/migrations/20260901000000_push_subscriptions_provider.sql` | Coluna `provider` |
| `mobile/app/_layout.tsx` | Raiz: sessão, tranca biométrica, deep-link de notificação |
| `mobile/app/(abas)/*` | As cinco abas |
| `mobile/app/ajustes.tsx` | Primeira tela 100% nativa: ajustes do aparelho |
| `mobile/app/aberto.tsx` | Destino do toque em notificação (qualquer caminho do produto) |
| `mobile/src/sessao/supabase.ts` | Cliente Supabase + LargeSecureStore |
| `mobile/src/sessao/ponte.ts` | Troca token→cookie e `flush()` do CookieManager |
| `mobile/src/ponte/TelaWeb.tsx` | WebView autenticada — **um** componente, usado por todas as abas não migradas |
| `mobile/src/nativo/push.ts` | Registro do token FCM e leitura do deep-link |
| `mobile/src/nativo/biometria.ts` | Tranca do app |
| `mobile/app.json` | Identidade, permissões, package name |

`TelaWeb.tsx` é o ponto de concentração de propósito da fase: rede, localização, links externos e erro de carregamento vivem **nele**, não espalhados por cinco abas.

---

## Task 1: Conta Google e Play Console

Tarefa **do usuário**, manual, sem código. Roda em paralelo com as tarefas 2 a 18 — e deve começar hoje, porque a verificação de identidade leva dias e trava tudo que vem depois.

- [ ] **Passo 1: Criar uma conta Google dedicada ao projeto**

Não usar a conta pessoal do dia a dia. Se um dia a empresa crescer ou você contratar alguém, a conta do app precisa ser transferível sem entregar seu e-mail pessoal. Sugestão: `arenahub.dev@gmail.com`.

- [ ] **Passo 2: Abrir o Play Console e pagar a taxa**

https://play.google.com/console/signup — taxa única de **US$ 25**, cartão internacional. Escolher **conta pessoal** (decidido na spec).

- [ ] **Passo 3: Verificação de identidade**

Documento com foto + comprovante de endereço. **Este é o passo lento** — pode levar de 2 a 10 dias. Enquanto não sair, nada pode ser publicado.

Atenção: o nome e o endereço informados aqui **ficam públicos na ficha da loja**. É exigência do Google para conta pessoal.

- [ ] **Passo 4: Criar o app no console**

- Nome: `ArenaHub`
- Idioma padrão: Português (Brasil)
- Tipo: App
- **Gratuito** — essa escolha é irreversível
- Categoria: Saúde e fitness

- [ ] **Passo 5: Anotar e guardar**

Guardar em lugar seguro (gerenciador de senhas, não no repositório): e-mail e senha da conta Google, e a confirmação de que o **Play App Signing** está ligado (é o padrão para apps novos).

---

## Task 2: Repositório vira workspace sem quebrar o web

**Files:**
- Modify: `package.json`

- [ ] **Passo 1: Registrar a baseline antes de mexer**

Rodar pelo **PowerShell**: `npm run test:run`

Anotar o número de testes que passam (esperado: 692, ou 691 depois das 21h). Esse número é o que a Task 2 tem de preservar.

- [ ] **Passo 2: Adicionar workspaces ao package.json da raiz**

Em `package.json`, logo depois de `"private": true`:

```json
  "private": true,
  "workspaces": [
    "packages/*",
    "mobile"
  ],
```

`packages/*` é listado agora e fica sem conteúdo — o primeiro pacote nasce no sub-projeto 3, quando existir tela nativa consumindo lógica compartilhada.

- [ ] **Passo 3: Reinstalar e verificar que nada quebrou**

```bash
npm install
npm run build
```

Esperado: build do Next.js conclui sem erro. Se `npm install` reclamar de workspace inexistente, é porque `mobile/` ainda não existe — nesse caso, faça a Task 3 antes e volte a este passo.

- [ ] **Passo 4: Rodar a suíte**

PowerShell: `npm run test:run`

Esperado: **o mesmo número do Passo 1**. Qualquer teste a menos significa que o hoisting do workspace mudou uma resolução de módulo — pare e investigue antes de seguir.

- [ ] **Passo 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: repositorio vira npm workspace (web permanece na raiz)"
```

---

## Task 3: Criar o app Expo

**Files:**
- Create: `mobile/` (projeto Expo completo)
- Modify: `.gitignore`

- [ ] **Passo 1: Criar o projeto**

Da raiz do repositório:

```bash
npx create-expo-app@latest mobile
```

Aceitar o template padrão (traz Expo Router e TypeScript). **Não** fixar versão de SDK no comando — `@latest` traz o SDK estável do momento, e fixar um SDK velho custa uma migração logo de cara.

- [ ] **Passo 2: Conferir a versão que veio**

```bash
node -p "require('./mobile/package.json').dependencies.expo"
```

Anotar o valor. Ele é o SDK do projeto e determina qual documentação consultar daqui pra frente.

- [ ] **Passo 3: Metro em monorepo**

A partir do SDK 52 o Metro descobre workspace sozinho — `mobile/metro.config.js` não precisa de `watchFolders` nem `nodeModulesPaths`. Se o SDK do Passo 2 for **anterior** ao 52, aí sim edite `mobile/metro.config.js`:

```javascript
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..');
const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

module.exports = config;
```

- [ ] **Passo 4: Ignorar artefatos nativos**

Acrescentar ao `.gitignore` da raiz:

```
# Expo
mobile/.expo/
mobile/dist/
mobile/android/
mobile/ios/
```

`android/` e `ios/` são ignorados porque o build é gerado (prebuild/EAS). Versioná-los cria conflito a cada mudança de plugin.

- [ ] **Passo 5: Rodar o app**

```bash
cd mobile && npx expo start
```

Instalar o **Expo Go** no celular Android e ler o QR Code. Esperado: a tela padrão do template abre no celular.

- [ ] **Passo 6: Commit**

```bash
git add mobile .gitignore package.json package-lock.json
git commit -m "feat(mobile): projeto Expo inicial"
```

---

## Task 4: Cliente Supabase no app com sessão cifrada

**Files:**
- Create: `mobile/src/sessao/supabase.ts`
- Create: `mobile/.env.local` (não versionado)
- Modify: `mobile/package.json` (dependências)

- [ ] **Passo 1: Instalar as dependências**

```bash
cd mobile
npx expo install @supabase/supabase-js @react-native-async-storage/async-storage expo-secure-store react-native-url-polyfill aes-js react-native-get-random-values
npm i -D @types/aes-js
```

`aes-js` e `react-native-get-random-values` existem por um motivo específico: o `expo-secure-store` **não guarda valores acima de 2048 bytes**, e a sessão do Supabase estoura isso. O padrão oficial é gerar uma chave AES-256, guardar só a chave no SecureStore, e guardar a sessão cifrada no AsyncStorage.

- [ ] **Passo 2: Criar `mobile/src/sessao/supabase.ts`**

```typescript
// mobile/src/sessao/supabase.ts
// Cliente Supabase do app. Equivalente nativo de lib/supabase/client.ts:
// mesma anon key, mesmo projeto — muda só onde a sessão é guardada.
//
// LargeSecureStore existe porque o SecureStore corta em 2048 bytes e a sessão
// do Supabase passa disso. A chave AES fica no Keystore/Keychain; a sessão
// cifrada fica no AsyncStorage. Guardar a sessão crua no AsyncStorage seria
// deixá-la legível por qualquer processo com acesso ao sandbox do app.
import 'react-native-url-polyfill/auto'
import 'react-native-get-random-values'
import { AppState } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import * as aesjs from 'aes-js'
import { createClient } from '@supabase/supabase-js'

class LargeSecureStore {
  private async _encrypt(key: string, value: string) {
    const encryptionKey = crypto.getRandomValues(new Uint8Array(256 / 8))
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1))
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value))
    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(encryptionKey))
    return aesjs.utils.hex.fromBytes(encryptedBytes)
  }

  private async _decrypt(key: string, value: string) {
    const encryptionKeyHex = await SecureStore.getItemAsync(key)
    if (!encryptionKeyHex) return encryptionKeyHex
    const cipher = new aesjs.ModeOfOperation.ctr(
      aesjs.utils.hex.toBytes(encryptionKeyHex),
      new aesjs.Counter(1),
    )
    const decryptedBytes = cipher.decrypt(aesjs.utils.hex.toBytes(value))
    return aesjs.utils.utf8.fromBytes(decryptedBytes)
  }

  async getItem(key: string) {
    const encrypted = await AsyncStorage.getItem(key)
    if (!encrypted) return encrypted
    return await this._decrypt(key, encrypted)
  }

  async setItem(key: string, value: string) {
    await AsyncStorage.setItem(key, await this._encrypt(key, value))
  }

  async removeItem(key: string) {
    await AsyncStorage.removeItem(key)
    await SecureStore.deleteItemAsync(key)
  }
}

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      storage: new LargeSecureStore(),
      autoRefreshToken: true,
      persistSession: true,
      // Sem isto o cliente tenta ler tokens da URL, que em app nativo não existe.
      detectSessionInUrl: false,
    },
  },
)

// O refresh automático só deve rodar com o app em primeiro plano; em segundo
// plano ele queimaria bateria e falharia em rede intermitente. Registrado uma
// única vez, no módulo.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh()
  else supabase.auth.stopAutoRefresh()
})
```

- [ ] **Passo 3: Criar `mobile/.env.local`**

```
EXPO_PUBLIC_SUPABASE_URL=https://fmzgsgwphsvkshzcnbwa.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<a mesma NEXT_PUBLIC_SUPABASE_ANON_KEY do projeto>
EXPO_PUBLIC_SITE_URL=https://arenahub.website
```

**A URL é a base do projeto, sem sufixo.** O `.env.example` da raiz traz `.../rest/v1/` no final — não copie: o `supabase-js` monta os caminhos sozinho e o sufixo produz URLs duplicadas.

Conferir que `mobile/.gitignore` já ignora `.env*.local` (o template do Expo ignora). Se não ignorar, acrescentar.

- [ ] **Passo 4: Verificar que o cliente sobe**

Em `mobile/app/index.tsx`, substituir o conteúdo por:

```tsx
import { Text, View } from 'react-native'
import { useEffect, useState } from 'react'
import { supabase } from '../src/sessao/supabase'

export default function Index() {
  const [estado, setEstado] = useState('checando…')
  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      setEstado(error ? `erro: ${error.message}` : data.session ? 'com sessão' : 'sem sessão')
    })
  }, [])
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>{estado}</Text>
    </View>
  )
}
```

Rodar `npx expo start` e abrir no celular. Esperado: **"sem sessão"**. Se aparecer "erro:", a URL ou a chave estão erradas — corrija antes de seguir.

- [ ] **Passo 5: Commit**

```bash
git add mobile
git commit -m "feat(mobile): cliente Supabase com sessao cifrada no dispositivo"
```

---

## Task 5: Login nativo

**Files:**
- Create: `mobile/app/login.tsx`
- Modify: `mobile/app/_layout.tsx`
- Modify: `mobile/app/index.tsx`

- [ ] **Passo 1: Criar `mobile/app/login.tsx`**

```tsx
// mobile/app/login.tsx
// Login nativo por e-mail/senha — o mesmo fluxo de app/(auth)/login.
// Recuperação de senha continua na web (abre no navegador): o link do e-mail
// depende do template do Supabase e não vale duplicar aqui.
import { useState } from 'react'
import { Alert, Pressable, Text, TextInput, View } from 'react-native'
import { supabase } from '../src/sessao/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function entrar() {
    setEnviando(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha })
    setEnviando(false)
    if (error) Alert.alert('Não foi possível entrar', error.message)
  }

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 12, backgroundColor: '#0c1220' }}>
      <Text style={{ color: '#f97316', fontSize: 28, fontWeight: '700', marginBottom: 12 }}>ArenaHub</Text>
      <TextInput
        placeholder="E-mail"
        placeholderTextColor="#64748b"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        style={{ backgroundColor: '#151e31', color: '#fff', borderRadius: 8, padding: 14, borderWidth: 1, borderColor: '#26334d' }}
      />
      <TextInput
        placeholder="Senha"
        placeholderTextColor="#64748b"
        secureTextEntry
        value={senha}
        onChangeText={setSenha}
        style={{ backgroundColor: '#151e31', color: '#fff', borderRadius: 8, padding: 14, borderWidth: 1, borderColor: '#26334d' }}
      />
      <Pressable
        onPress={entrar}
        disabled={enviando}
        style={{ backgroundColor: '#ea580c', borderRadius: 8, padding: 16, alignItems: 'center', opacity: enviando ? 0.6 : 1 }}
      >
        <Text style={{ color: '#fff', fontWeight: '700' }}>{enviando ? 'Entrando…' : 'Entrar'}</Text>
      </Pressable>
    </View>
  )
}
```

- [ ] **Passo 2: Substituir `mobile/app/_layout.tsx`**

```tsx
// mobile/app/_layout.tsx
// Raiz do app. Decide entre login e área logada a partir da sessão do Supabase,
// e é o único lugar que observa onAuthStateChange — telas leem o contexto.
import { createContext, useContext, useEffect, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Slot, useRouter, useSegments } from 'expo-router'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../src/sessao/supabase'

const SessaoContexto = createContext<Session | null>(null)
export const useSessao = () => useContext(SessaoContexto)

export default function RootLayout() {
  const [sessao, setSessao] = useState<Session | null>(null)
  const [carregando, setCarregando] = useState(true)
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSessao(data.session)
      setCarregando(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, s) => setSessao(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (carregando) return
    const naTelaDeLogin = segments[0] === 'login'
    if (!sessao && !naTelaDeLogin) router.replace('/login')
    if (sessao && naTelaDeLogin) router.replace('/')
  }, [sessao, carregando, segments, router])

  if (carregando) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0c1220' }}>
        <ActivityIndicator color="#f97316" />
      </View>
    )
  }

  return (
    <SessaoContexto.Provider value={sessao}>
      <Slot />
    </SessaoContexto.Provider>
  )
}
```

- [ ] **Passo 3: Testar no celular**

`npx expo start`. Esperado: abre a tela de login. Entrar com um usuário real de produção. Esperado: a tela de login some e cai em `index.tsx` mostrando "com sessão".

Fechar o app completamente e reabrir. Esperado: **continua logado** — é o que prova que o LargeSecureStore está persistindo.

- [ ] **Passo 4: Commit**

```bash
git add mobile
git commit -m "feat(mobile): login nativo e guarda de sessao"
```

---

## Task 6: Rota de ponte de sessão (token → cookie)

A peça crítica da fase e a única superfície nova de autenticação do projeto. Feita por TDD.

**Files:**
- Create: `app/api/auth/sessao-nativa/route.ts`
- Create: `app/api/auth/sessao-nativa/route.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `app/api/auth/sessao-nativa/route.test.ts`:

```typescript
// app/api/auth/sessao-nativa/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { POST } from './route'
import { createClient } from '@/lib/supabase/server'

/**
 * Fake client: só auth.setSession + auth.getUser, que é tudo que a rota usa.
 * `usuario` null simula token que o Auth recusa.
 */
function makeClient({ usuario, erroSetSession = false }: { usuario: unknown; erroSetSession?: boolean }) {
  const setSession = vi.fn(async () => (erroSetSession
    ? { data: { session: null }, error: { message: 'invalid' } }
    : { data: { session: { access_token: 'a' } }, error: null }))
  const getUser = vi.fn(async () => ({ data: { user: usuario }, error: null }))
  return { client: { auth: { setSession, getUser } } as never, setSession, getUser }
}

function req(body: unknown) {
  return new Request('https://arenahub.website/api/auth/sessao-nativa', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => vi.clearAllMocks())

describe('POST /api/auth/sessao-nativa', () => {
  it('sem os dois tokens devolve 400 e nao toca no Supabase', async () => {
    const { client, setSession } = makeClient({ usuario: { id: 'u1' } })
    vi.mocked(createClient).mockReturnValue(client)

    const res = await POST(req({ access_token: 'so-esse' }))

    expect(res.status).toBe(400)
    expect(setSession).not.toHaveBeenCalled()
  })

  it('token recusado pelo Auth devolve 401', async () => {
    const { client } = makeClient({ usuario: null, erroSetSession: true })
    vi.mocked(createClient).mockReturnValue(client)

    const res = await POST(req({ access_token: 'a', refresh_token: 'r' }))

    expect(res.status).toBe(401)
  })

  // setSession sozinho só decodifica o JWT — não pergunta ao servidor se ele
  // ainda vale. Sem o getUser, um token revogado viraria cookie válido.
  it('setSession ok mas getUser sem usuario devolve 401', async () => {
    const { client, getUser } = makeClient({ usuario: null })
    vi.mocked(createClient).mockReturnValue(client)

    const res = await POST(req({ access_token: 'a', refresh_token: 'r' }))

    expect(res.status).toBe(401)
    expect(getUser).toHaveBeenCalled()
  })

  it('tokens validos devolvem 204 sem corpo', async () => {
    const { client, setSession } = makeClient({ usuario: { id: 'u1' } })
    vi.mocked(createClient).mockReturnValue(client)

    const res = await POST(req({ access_token: 'a', refresh_token: 'r' }))

    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    expect(setSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'r' })
  })

  it('corpo que nao e JSON devolve 400 em vez de estourar', async () => {
    const { client } = makeClient({ usuario: { id: 'u1' } })
    vi.mocked(createClient).mockReturnValue(client)

    const res = await POST(new Request('https://arenahub.website/api/auth/sessao-nativa', {
      method: 'POST',
      body: 'nao-e-json',
    }))

    expect(res.status).toBe(400)
  })
})
```

- [ ] **Passo 2: Rodar e ver falhar**

PowerShell: `npm run test:run -- app/api/auth/sessao-nativa/route.test.ts`

Esperado: FAIL — `Failed to resolve import "./route"`.

- [ ] **Passo 3: Implementar a rota**

Criar `app/api/auth/sessao-nativa/route.ts`:

```typescript
// app/api/auth/sessao-nativa/route.ts
// Ponte de sessão do app nativo: recebe os tokens que o app guarda no
// dispositivo e devolve os cookies sb-* que o @supabase/ssr espera, para que as
// telas web abertas dentro do app rodem logadas.
//
// POST, nunca GET: token em query string vaza para log de servidor, histórico
// do navegador e Referer. O corpo de resposta é vazio de propósito — quem chama
// já tem os tokens, e devolver dado de usuário aqui só aumentaria a superfície.
//
// setSession sozinho não basta: ele decodifica o JWT localmente e aceitaria um
// token revogado. O getUser em seguida é a validação real contra o Auth.
//
// A rota não é alcançada pelo middleware (o matcher exclui /api).
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let corpo: { access_token?: unknown; refresh_token?: unknown }
  try {
    corpo = await request.json()
  } catch {
    return new NextResponse(null, { status: 400 })
  }

  const accessToken = corpo.access_token
  const refreshToken = corpo.refresh_token
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
    return new NextResponse(null, { status: 400 })
  }

  const supabase = createClient()

  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  })
  if (error) return new NextResponse(null, { status: 401 })

  const { data } = await supabase.auth.getUser()
  if (!data.user) return new NextResponse(null, { status: 401 })

  // 204: os cookies foram gravados pelo adapter de createClient().
  return new NextResponse(null, { status: 204 })
}
```

- [ ] **Passo 4: Rodar e ver passar**

PowerShell: `npm run test:run -- app/api/auth/sessao-nativa/route.test.ts`

Esperado: 5 testes passando.

- [ ] **Passo 5: Rodar a suíte inteira**

PowerShell: `npm run test:run`

Esperado: baseline + 5.

- [ ] **Passo 6: Commit**

```bash
git add app/api/auth/sessao-nativa
git commit -m "feat(api): ponte de sessao do app nativo (token para cookie)"
```

---

## Task 7: WebView autenticada

**Files:**
- Create: `mobile/src/sessao/ponte.ts`
- Create: `mobile/src/ponte/TelaWeb.tsx`

- [ ] **Passo 1: Instalar**

```bash
cd mobile
npx expo install react-native-webview @react-native-cookies/cookies
```

`@react-native-cookies/cookies` entra por um motivo específico: no Android o `fetch` do React Native e a WebView compartilham o `CookieManager`, **mas o cookie só fica visível para a WebView depois de um `flush()`**. Sem ele, a primeira tela abre deslogada de forma intermitente.

- [ ] **Passo 2: Criar `mobile/src/sessao/ponte.ts`**

```typescript
// mobile/src/sessao/ponte.ts
// Entrega ao servidor os tokens que o app guarda, para que as telas web
// abertas dentro do app rodem logadas. Ver app/api/auth/sessao-nativa/route.ts.
//
// Android: o fetch do RN escreve no mesmo CookieManager que a WebView lê, mas
// só depois de flush(). iOS NÃO compartilha esse armazém (WKHTTPCookieStore é
// separado do NSHTTPCookieStorage) — resolver isso é tarefa da fase iOS.
import CookieManager from '@react-native-cookies/cookies'
import { supabase } from './supabase'

const SITE = process.env.EXPO_PUBLIC_SITE_URL!

export async function sincronizarSessaoComWebView(): Promise<boolean> {
  const { data } = await supabase.auth.getSession()
  const sessao = data.session
  if (!sessao) return false

  const resposta = await fetch(`${SITE}/api/auth/sessao-nativa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: sessao.access_token,
      refresh_token: sessao.refresh_token,
    }),
  })
  if (!resposta.ok) return false

  await CookieManager.flush()
  return true
}
```

- [ ] **Passo 3: Criar `mobile/src/ponte/TelaWeb.tsx`**

```tsx
// mobile/src/ponte/TelaWeb.tsx
// A WebView autenticada — o mecanismo que permite ter app na loja antes de
// qualquer tela nativa de produto. Toda aba ainda não migrada é uma instância
// disto com um caminho diferente.
//
// Quatro responsabilidades ficam aqui de propósito, e não espalhadas pelas
// abas: sincronizar a sessão antes do primeiro load, mandar link externo para
// fora, tratar falha de carregamento, e ligar a geolocalização (o check-in por
// GPS depende dela).
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { WebView } from 'react-native-webview'
import * as WebBrowser from 'expo-web-browser'
import { sincronizarSessaoComWebView } from '../sessao/ponte'

const SITE = process.env.EXPO_PUBLIC_SITE_URL!

export function TelaWeb({ caminho }: { caminho: string }) {
  const [pronto, setPronto] = useState(false)
  const [erro, setErro] = useState(false)
  const webviewRef = useRef<WebView>(null)

  useEffect(() => {
    let ativo = true
    sincronizarSessaoComWebView().then((ok) => {
      if (!ativo) return
      if (!ok) setErro(true)
      setPronto(true)
    })
    return () => { ativo = false }
  }, [])

  function recarregar() {
    setErro(false)
    setPronto(false)
    sincronizarSessaoComWebView().then((ok) => {
      if (!ok) setErro(true)
      setPronto(true)
      webviewRef.current?.reload()
    })
  }

  if (!pronto) {
    return (
      <View style={estilos.centro}>
        <ActivityIndicator color="#f97316" />
      </View>
    )
  }

  if (erro) {
    return (
      <View style={estilos.centro}>
        <Text style={estilos.titulo}>Sem conexão</Text>
        <Text style={estilos.texto}>Não conseguimos falar com o servidor.</Text>
        <Pressable onPress={recarregar} style={estilos.botao}>
          <Text style={estilos.botaoTexto}>Tentar de novo</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <WebView
      ref={webviewRef}
      source={{ uri: `${SITE}${caminho}` }}
      // O check-in por GPS não funciona sem isto no Android: a WebView ignora
      // navigator.geolocation por padrão.
      geolocationEnabled
      sharedCookiesEnabled
      thirdPartyCookiesEnabled
      onError={() => setErro(true)}
      onHttpError={({ nativeEvent }) => { if (nativeEvent.statusCode >= 500) setErro(true) }}
      // Link para fora do nosso domínio abre no navegador do sistema. Checkout
      // do Mercado Pago dentro da WebView quebra o pagamento; WhatsApp e Google
      // Calendar precisam do app do sistema.
      onShouldStartLoadWithRequest={(req) => {
        if (req.url.startsWith(SITE)) return true
        WebBrowser.openBrowserAsync(req.url)
        return false
      }}
      style={{ flex: 1, backgroundColor: '#0c1220' }}
    />
  )
}

const estilos = StyleSheet.create({
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0c1220', padding: 24, gap: 8 },
  titulo: { color: '#fff', fontSize: 18, fontWeight: '700' },
  texto: { color: '#94a3b8', textAlign: 'center' },
  botao: { marginTop: 12, backgroundColor: '#ea580c', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 24 },
  botaoTexto: { color: '#fff', fontWeight: '700' },
})
```

- [ ] **Passo 4: Verificar no celular**

Trocar `mobile/app/index.tsx` por:

```tsx
import { TelaWeb } from '../src/ponte/TelaWeb'
export default function Index() {
  return <TelaWeb caminho="/inicio" />
}
```

`npx expo start`, entrar com um usuário real.

Esperado, e cada um destes é um critério de aceite:
1. A home do aluno abre **já logada** — nenhuma tela de login da web aparece.
2. Entrar com um usuário admin cai em `/admin/dashboard` (é a decisão de `app/inicio/page.tsx` funcionando de dentro do app).
3. Tocar num link de WhatsApp abre **fora** do app.
4. Desligar o wi-fi e os dados, reabrir a aba: aparece "Sem conexão" com botão, não tela branca.

- [ ] **Passo 5: Commit**

```bash
git add mobile
git commit -m "feat(mobile): WebView autenticada com link externo e tela de falha"
```

---

## Task 8: Abas nativas

**Files:**
- Create: `mobile/app/(abas)/_layout.tsx`
- Create: `mobile/app/(abas)/index.tsx`, `explorar.tsx`, `arena.tsx`, `liga.tsx`, `perfil.tsx`
- Delete: `mobile/app/index.tsx`

- [ ] **Passo 1: Instalar os ícones**

```bash
cd mobile && npx expo install @expo/vector-icons
```

- [ ] **Passo 2: Criar `mobile/app/(abas)/_layout.tsx`**

Espelha `components/ui/BottomNav.tsx`: Explorar, Arena, Home, Liga, Perfil.

```tsx
// mobile/app/(abas)/_layout.tsx
// Abas nativas espelhando components/ui/BottomNav.tsx do web. Cada aba ainda é
// uma TelaWeb; a barra é que já é nativa, e é o que faz o app parecer app.
import { Tabs } from 'expo-router'
import { Feather } from '@expo/vector-icons'

export default function AbasLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#f97316',
        tabBarInactiveTintColor: '#64748b',
        tabBarStyle: { backgroundColor: '#151e31', borderTopColor: '#26334d' },
      }}
    >
      <Tabs.Screen name="explorar" options={{ title: 'Explorar', tabBarIcon: ({ color, size }) => <Feather name="compass" color={color} size={size} /> }} />
      <Tabs.Screen name="arena" options={{ title: 'Arena', tabBarIcon: ({ color, size }) => <Feather name="map-pin" color={color} size={size} /> }} />
      <Tabs.Screen name="index" options={{ title: 'Início', tabBarIcon: ({ color, size }) => <Feather name="home" color={color} size={size} /> }} />
      <Tabs.Screen name="liga" options={{ title: 'Liga', tabBarIcon: ({ color, size }) => <Feather name="award" color={color} size={size} /> }} />
      <Tabs.Screen name="perfil" options={{ title: 'Perfil', tabBarIcon: ({ color, size }) => <Feather name="user" color={color} size={size} /> }} />
    </Tabs>
  )
}
```

- [ ] **Passo 3: Criar as cinco telas**

`mobile/app/(abas)/index.tsx`:

```tsx
import { TelaWeb } from '../../src/ponte/TelaWeb'
export default function Inicio() { return <TelaWeb caminho="/inicio" /> }
```

`mobile/app/(abas)/explorar.tsx`:

```tsx
import { TelaWeb } from '../../src/ponte/TelaWeb'
export default function Explorar() { return <TelaWeb caminho="/explorar" /> }
```

`mobile/app/(abas)/arena.tsx`:

```tsx
import { TelaWeb } from '../../src/ponte/TelaWeb'
export default function Arena() { return <TelaWeb caminho="/torneios" /> }
```

`mobile/app/(abas)/liga.tsx`:

```tsx
import { TelaWeb } from '../../src/ponte/TelaWeb'
export default function Liga() { return <TelaWeb caminho="/liga" /> }
```

`mobile/app/(abas)/perfil.tsx`:

```tsx
import { TelaWeb } from '../../src/ponte/TelaWeb'
export default function Perfil() { return <TelaWeb caminho="/perfil" /> }
```

- [ ] **Passo 4: Remover a tela solta**

```bash
rm mobile/app/index.tsx
```

- [ ] **Passo 5: Esconder o BottomNav do web dentro do app**

Sem isso o aluno vê **duas** barras de navegação empilhadas.

Em `mobile/src/ponte/TelaWeb.tsx`, acrescentar a prop no `<WebView>`:

```tsx
      injectedJavaScriptBeforeContentLoaded={`document.documentElement.classList.add('dentro-do-app'); true;`}
```

Em `app/globals.css`, no fim do arquivo:

```css
/* Dentro do app nativo a navegação é a barra de abas do sistema — o BottomNav
   do web apareceria empilhado sob ela. Injetado por mobile/src/ponte/TelaWeb.tsx. */
.dentro-do-app [data-bottom-nav] {
  display: none;
}
.dentro-do-app main {
  padding-bottom: 0;
}
```

Em `components/ui/BottomNav.tsx`, acrescentar `data-bottom-nav` ao elemento `<nav>` mais externo.

- [ ] **Passo 6: Verificar**

`npx expo start`. Esperado: cinco abas nativas na base, cada uma abre a tela certa logada, e **não** existe uma segunda barra dentro da página.

- [ ] **Passo 7: Rodar a suíte do web**

PowerShell: `npm run test:run`

Esperado: baseline + 5 (o `data-bottom-nav` é atributo novo, não muda comportamento).

- [ ] **Passo 8: Commit**

```bash
git add mobile app/globals.css components/ui/BottomNav.tsx
git commit -m "feat(mobile): abas nativas e supressao do BottomNav web dentro do app"
```

---

## Task 9: Permissão de localização

**Files:**
- Modify: `mobile/app.json`
- Modify: `mobile/src/ponte/TelaWeb.tsx`

Sem esta tarefa o check-in por GPS (`features/checkin/SelfCheckinPanel.tsx`) fica pedindo localização para sempre dentro do app: `geolocationEnabled` só libera a API para a página — quem tem de conceder a permissão do sistema é o app.

- [ ] **Passo 1: Instalar**

```bash
cd mobile && npx expo install expo-location
```

- [ ] **Passo 2: Declarar a permissão em `mobile/app.json`**

Dentro de `expo.android`, acrescentar:

```json
      "permissions": ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION"]
```

E em `expo.plugins`, acrescentar o item:

```json
      [
        "expo-location",
        { "locationAlwaysAndWhenInUsePermission": "O ArenaHub usa sua localização para confirmar presença na aula." }
      ]
```

- [ ] **Passo 3: Pedir a permissão antes de montar a WebView**

Em `mobile/src/ponte/TelaWeb.tsx`, acrescentar o import:

```tsx
import * as Location from 'expo-location'
```

e trocar o `useEffect` de sincronização por:

```tsx
  useEffect(() => {
    let ativo = true
    // A permissão é pedida antes da WebView montar: pedida depois, o diálogo
    // aparece por cima de uma página já carregada e o check-in falha na
    // primeira tentativa.
    Location.requestForegroundPermissionsAsync()
      .catch(() => null)
      .then(() => sincronizarSessaoComWebView())
      .then((ok) => {
        if (!ativo) return
        if (!ok) setErro(true)
        setPronto(true)
      })
    return () => { ativo = false }
  }, [])
```

O `.catch(() => null)` é deliberado: recusar a localização não pode impedir o app de abrir — só o check-in por GPS depende dela.

- [ ] **Passo 4: Verificar**

`npx expo start`. Esperado: na primeira abertura o Android pede permissão de localização. Concedendo e indo até uma aula com self check-in disponível, o painel encontra a posição.

Se o Expo Go não pedir a permissão, é limitação dele — reconfirme na Task 19, com o build do EAS.

- [ ] **Passo 5: Commit**

```bash
git add mobile
git commit -m "feat(mobile): permissao de localizacao para o check-in por GPS"
```

---

## Task 10: Coluna `provider` em `push_subscriptions`

**Files:**
- Create: `supabase/migrations/20260901000000_push_subscriptions_provider.sql`

- [ ] **Passo 1: Escrever a migration**

```sql
-- supabase/migrations/20260901000000_push_subscriptions_provider.sql

-- O app nativo não tem Web Push: a WebView do Android não implementa a Push
-- API. O transporte passa a ser escolhido POR LINHA, para que o mesmo usuário
-- receba no navegador (web) e no app (fcm) sem que notifyUsers saiba disso.
--
-- default 'web': toda linha existente é uma inscrição Web Push válida e
-- continua funcionando sem backfill.
alter table push_subscriptions
  add column if not exists provider text not null default 'web'
    check (provider in ('web', 'fcm', 'apns'));

-- p256dh/auth são chaves do Web Push e não existem em FCM. Passam a ser
-- opcionais; a trava de coerência é o check abaixo, não o not null.
alter table push_subscriptions alter column p256dh drop not null;
alter table push_subscriptions alter column auth   drop not null;

-- Linha web sem as chaves não envia nada; linha fcm com elas é confusão de
-- transporte. O banco recusa as duas.
alter table push_subscriptions
  drop constraint if exists push_subscriptions_chaves_por_provider;
alter table push_subscriptions
  add constraint push_subscriptions_chaves_por_provider check (
    (provider = 'web' and p256dh is not null and auth is not null)
    or (provider in ('fcm', 'apns') and p256dh is null and auth is null)
  );

create index if not exists idx_push_subscriptions_provider
  on push_subscriptions(provider);
```

Em FCM o token do dispositivo é guardado em `endpoint` — a coluna já é `text not null unique`, que é exatamente a semântica de um token de dispositivo.

- [ ] **Passo 2: Commit**

```bash
git add supabase/migrations/20260901000000_push_subscriptions_provider.sql
git commit -m "feat(db): coluna provider em push_subscriptions"
```

- [ ] **Passo 3: Pedir a aplicação ao usuário**

**Parar aqui e pedir:** "Aplique `supabase/migrations/20260901000000_push_subscriptions_provider.sql` no SQL Editor do Supabase e me avise." O `supabase db push` não tem auth nesta máquina, e as tarefas 11 e 14 dependem da coluna existir.

---

## Task 11: Envio via FCM

Só o módulo de envio, isolado e testado. Quem o liga ao dispatch é a Task 12 — separado porque este commit compila e passa sozinho.

**Files:**
- Create: `lib/notifications/pushFcm.ts`
- Create: `lib/notifications/pushFcm.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `lib/notifications/pushFcm.test.ts`:

```typescript
// lib/notifications/pushFcm.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendFcmPush } from './pushFcm'

const ENV_ORIGINAL = { ...process.env }

beforeEach(() => {
  vi.restoreAllMocks()
  process.env.FCM_PROJECT_ID = 'proj'
  process.env.FCM_ACCESS_TOKEN = 'token-de-teste'
})

afterEach(() => {
  process.env = { ...ENV_ORIGINAL }
})

describe('sendFcmPush', () => {
  it('sem credencial devolve skipped e nao chama a rede', async () => {
    delete process.env.FCM_PROJECT_ID
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const r = await sendFcmPush({ token: 't', title: 'Oi', body: 'Corpo' })

    expect(r).toBe('skipped')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('envia titulo, corpo e url no data e devolve ok', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 }),
    )

    const r = await sendFcmPush({ token: 'tok', title: 'Oi', body: 'Corpo', url: '/aulas/1' })

    expect(r).toBe('ok')
    const [, init] = fetchSpy.mock.calls[0]
    const corpo = JSON.parse(String(init?.body))
    expect(corpo.message.token).toBe('tok')
    expect(corpo.message.notification).toEqual({ title: 'Oi', body: 'Corpo' })
    expect(corpo.message.data.url).toBe('/aulas/1')
  })

  it('sem url explicita manda /home, igual ao web push', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))

    await sendFcmPush({ token: 'tok', title: 'Oi', body: 'Corpo' })
  })

  // Token de app desinstalado. O dispatch usa 'expired' para podar a linha —
  // sem isso, cada broadcast tentaria para sempre um aparelho que não existe.
  it('404 e 403 viram expired', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 404 }))
    expect(await sendFcmPush({ token: 't', title: 'a', body: 'b' })).toBe('expired')

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 403 }))
    expect(await sendFcmPush({ token: 't', title: 'a', body: 'b' })).toBe('expired')
  })

  it('500 relanca, para o dispatch reportar ao Sentry', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('erro', { status: 500 }))

    await expect(sendFcmPush({ token: 't', title: 'a', body: 'b' })).rejects.toThrow()
  })
})
```

- [ ] **Passo 2: Rodar e ver falhar**

PowerShell: `npm run test:run -- lib/notifications/pushFcm.test.ts`

Esperado: FAIL — `Failed to resolve import "./pushFcm"`.

- [ ] **Passo 3: Implementar `lib/notifications/pushFcm.ts`**

```typescript
// lib/notifications/pushFcm.ts
// Envio via FCM HTTP v1. Mesmo contrato de lib/notifications/push.ts: I/O puro,
// fail-closed sem credencial, 'expired' para o dispatch podar a linha.
//
// O token de acesso vem pronto na env (FCM_ACCESS_TOKEN) em vez de ser assinado
// aqui a partir da service account: assinar JWT exigiria uma dependência de
// crypto no caminho quente do dispatch. Renovar o token é responsabilidade do
// cron mp-token-refresh-like que a fase de operação vai definir; enquanto isso,
// credencial ausente ou vencida degrada para 'skipped'/erro reportado, nunca
// derruba a ação de origem.
export interface SendFcmPushParams {
  token: string
  title: string
  body: string
  url?: string
}

export type SendFcmPushResult = 'ok' | 'expired' | 'skipped'

export async function sendFcmPush({
  token,
  title,
  body,
  url,
}: SendFcmPushParams): Promise<SendFcmPushResult> {
  const projectId = process.env.FCM_PROJECT_ID
  const accessToken = process.env.FCM_ACCESS_TOKEN
  if (!projectId || !accessToken) {
    console.log('[pushFcm] credencial FCM ausente — envio ignorado', { token: token.slice(0, 12) })
    return 'skipped'
  }

  const resposta = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          // data só aceita string; o app lê url no toque da notificação.
          data: { url: url ?? '/home' },
        },
      }),
    },
  )

  if (resposta.ok) return 'ok'
  // 404 = token desconhecido; 403 = token de outro projeto. Os dois são linha
  // morta e devem ser podados, não retentados.
  if (resposta.status === 404 || resposta.status === 403) return 'expired'
  throw new Error(`[pushFcm] FCM devolveu ${resposta.status}`)
}
```

- [ ] **Passo 4: Rodar e ver passar**

PowerShell: `npm run test:run -- lib/notifications/pushFcm.test.ts`

Esperado: 5 testes passando.

- [ ] **Passo 5: Commit**

`pushFcm.ts` ainda não tem consumidor — quem o liga é a Task 12. Fica assim de propósito: este commit compila e passa sozinho.

```bash
git add lib/notifications/pushFcm.ts lib/notifications/pushFcm.test.ts
git commit -m "feat(push): envio via FCM HTTP v1"
```

---

## Task 12: `url` de deep-link e roteamento por provider no dispatch

Uma mudança só, porque as duas metades não compilam separadas: o dispatch passa a escolher o transporte por linha **e** a repassar o `url`. Resolve de quebra a pendência conhecida de o push sempre abrir `/home`.

`url` é **opcional** e nenhum dos ~20 chamadores é alterado nesta fase.

**Files:**
- Modify: `lib/notifications/dispatch.ts:29-35,58-60,109-137`
- Create: `lib/notifications/dispatchUrl.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `lib/notifications/dispatchUrl.test.ts`:

```typescript
// lib/notifications/dispatchUrl.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./push', () => ({ sendPush: vi.fn(async () => 'ok') }))
vi.mock('./pushFcm', () => ({ sendFcmPush: vi.fn(async () => 'ok') }))
vi.mock('./email', () => ({ sendEmail: vi.fn() }))
vi.mock('./whatsapp', () => ({ sendWhatsApp: vi.fn() }))

import { notifyUsers } from './dispatch'
import { sendPush } from './push'
import { sendFcmPush } from './pushFcm'

/** Fake client: só o from('push_subscriptions').select().in() do canal push. */
function makeClient(subs: unknown[]) {
  return {
    from: () => {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.in = () => Promise.resolve({ data: subs })
      b.insert = () => Promise.resolve({ error: null })
      b.delete = () => b
      b.eq = () => Promise.resolve({ error: null })
      return b
    },
  } as never
}

const base = {
  orgId: 'org-1',
  recipients: [{ userId: 'u1' }],
  type: 'waitlist_offer',
  title: 'Vaga liberada',
  body: 'Você entrou na aula',
}

const LINHA_WEB = { user_id: 'u1', endpoint: 'https://fcm.example/x', p256dh: 'p', auth: 'a', provider: 'web' }
const LINHA_FCM = { user_id: 'u1', endpoint: 'token-fcm', p256dh: null, auth: null, provider: 'fcm' }

beforeEach(() => vi.clearAllMocks())

describe('notifyUsers — transporte por linha e deep-link', () => {
  it('linha web vai por web push, com a url', async () => {
    await notifyUsers(makeClient([LINHA_WEB]), { ...base, channels: ['push'], url: '/aulas/123' })

    expect(sendFcmPush).not.toHaveBeenCalled()
    expect(vi.mocked(sendPush).mock.calls[0][0].url).toBe('/aulas/123')
  })

  it('linha fcm vai por FCM, com a url', async () => {
    await notifyUsers(makeClient([LINHA_FCM]), { ...base, channels: ['push'], url: '/aulas/123' })

    expect(sendPush).not.toHaveBeenCalled()
    expect(vi.mocked(sendFcmPush).mock.calls[0][0]).toMatchObject({ token: 'token-fcm', url: '/aulas/123' })
  })

  // O aluno com navegador E app tem as duas linhas e precisa receber nas duas.
  it('usuario com as duas linhas recebe pelos dois transportes', async () => {
    await notifyUsers(makeClient([LINHA_WEB, LINHA_FCM]), { ...base, channels: ['push'] })

    expect(sendPush).toHaveBeenCalledTimes(1)
    expect(sendFcmPush).toHaveBeenCalledTimes(1)
  })

  // Os ~20 chamadores atuais não passam url. Eles não podem quebrar.
  it('sem url o envio segue normalmente', async () => {
    await notifyUsers(makeClient([LINHA_FCM]), { ...base, channels: ['push'] })

    expect(vi.mocked(sendFcmPush).mock.calls[0][0].url).toBeUndefined()
  })
})
```

- [ ] **Passo 2: Rodar e ver falhar**

PowerShell: `npm run test:run -- lib/notifications/dispatchUrl.test.ts`

Esperado: FAIL — `url` não existe em `NotifyUsersParams` e o dispatch ainda manda tudo por `sendPush`.

- [ ] **Passo 3: Adicionar o parâmetro `url`**

Em `lib/notifications/dispatch.ts`, na interface:

```typescript
export interface NotifyUsersParams {
  orgId: string
  recipients: NotifyRecipient[]
  type: NotificationType
  title: string
  body: string
  channels: NotificationChannel[]
  /**
   * Caminho que o toque na notificação deve abrir (ex.: '/aulas/123'). Só o
   * canal push usa. Omitido, o app abre '/home' — que era o comportamento
   * único antes desta fase. Opcional de propósito: os chamadores existentes
   * adotam um a um, conforme cada domínio for migrado para tela nativa.
   */
  url?: string
}
```

E na desestruturação da assinatura:

```typescript
  { orgId, recipients, type, title, body, channels, url }: NotifyUsersParams,
```

- [ ] **Passo 4: Rotear por provider**

Ainda em `lib/notifications/dispatch.ts`, acrescentar o import junto dos outros:

```typescript
import { sendFcmPush } from './pushFcm'
```

e substituir o bloco `if (channels.includes('push')) { … }` (linhas 109-137) por:

```typescript
  if (channels.includes('push')) {
    const userIds = recipients.map((r) => r.userId)
    const { data: subs } = await client
      .from('push_subscriptions')
      .select('user_id, endpoint, p256dh, auth, provider')
      .in('user_id', userIds)

    for (const s of (subs ?? []) as {
      user_id: string
      endpoint: string
      p256dh: string | null
      auth: string | null
      provider: 'web' | 'fcm' | 'apns'
    }[]) {
      try {
        // O transporte é escolhido por LINHA: o mesmo usuário pode ter uma
        // inscrição web (navegador) e uma fcm (app) e recebe nas duas.
        const result =
          s.provider === 'web'
            ? await sendPush({
                subscription: { endpoint: s.endpoint, p256dh: s.p256dh!, auth: s.auth! },
                title,
                body,
                url,
              })
            : await sendFcmPush({ token: s.endpoint, title, body, url })

        if (result === 'expired') {
          await client.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
        }
      } catch (err) {
        Sentry.captureException(err, {
          tags: { channel: 'push', notificationType: type, provider: s.provider },
          extra: { orgId, userId: s.user_id },
        })
      }
    }
  }
```

- [ ] **Passo 5: Rodar e ver passar**

PowerShell: `npm run test:run -- lib/notifications/dispatchUrl.test.ts`

Esperado: 4 testes passando.

- [ ] **Passo 6: Rodar a suite inteira e o build**

PowerShell: `npm run test:run`
Esperado: baseline + 14 (5 da ponte, 5 do FCM, 4 daqui).

```bash
npm run build
```
Esperado: build limpo.

- [ ] **Passo 7: Commit**

```bash
git add lib/notifications/dispatch.ts lib/notifications/dispatchUrl.test.ts
git commit -m "feat(push): roteamento por provider e url de deep-link em notifyUsers"
```

---

## Task 13: Projeto Firebase e credenciais

Tarefa **do usuário**, manual. Sem ela a Task 14 não tem onde registrar o token.

- [ ] **Passo 1: Criar o projeto no Firebase**

https://console.firebase.google.com → Adicionar projeto → nome `ArenaHub`. Pode desligar o Google Analytics.

- [ ] **Passo 2: Registrar o app Android**

No projeto, ícone do Android. Nome do pacote: **`website.arenahub.app`** — exatamente esse, e é o mesmo que vai em `mobile/app.json` na Task 17.

Baixar o `google-services.json` gerado e salvar em `mobile/google-services.json`.

- [ ] **Passo 3: Não versionar o arquivo**

Acrescentar ao `.gitignore` da raiz:

```
mobile/google-services.json
```

Ele não contém segredo de servidor, mas identifica o projeto Firebase e não precisa circular. O EAS recebe uma cópia na Task 18.

- [ ] **Passo 4: Criar a service account do envio**

Firebase → Configurações do projeto → Contas de serviço → **Gerar nova chave privada**. Guardar o JSON fora do repositório.

- [ ] **Passo 5: Envs na Vercel**

Em Production e Preview:

- `FCM_PROJECT_ID` = o `project_id` do JSON
- `FCM_ACCESS_TOKEN` = deixar **vazio** por enquanto

Com `FCM_ACCESS_TOKEN` vazio, `sendFcmPush` devolve `'skipped'` e nada quebra — é o mesmo desenho fail-closed do Web Push sem VAPID.

- [ ] **Passo 6: Gerar um token de teste, quando for testar o envio**

O token do FCM vale **1 hora**. Nesta fase ele é gerado à mão; renová-lo por cron é tarefa do sub-projeto 2.

Instalar o [gcloud CLI](https://cloud.google.com/sdk/docs/install), e então:

```bash
gcloud auth activate-service-account --key-file=<caminho-do-json-da-service-account>
gcloud auth print-access-token --scopes=https://www.googleapis.com/auth/firebase.messaging
```

Colar a saída em `FCM_ACCESS_TOKEN` na Vercel e fazer redeploy. Vencido o prazo, o envio volta a falhar com 401 — que o `sendFcmPush` relança e o dispatch reporta ao Sentry, sem derrubar nada.

- [ ] **Passo 7: Acrescentar ao `.env.example`**

```
# Firebase Cloud Messaging (push do app nativo). Sem estes, sendFcmPush
# devolve 'skipped' e o push do app é ignorado — o web push segue normal.
FCM_PROJECT_ID=
FCM_ACCESS_TOKEN=
```

```bash
git add .env.example .gitignore
git commit -m "chore: envs do FCM no .env.example"
```

---

## Task 14: Registro do token FCM no app

**Files:**
- Create: `mobile/src/nativo/push.ts`
- Modify: `mobile/app/_layout.tsx`
- Modify: `mobile/app.json`

- [ ] **Passo 1: Instalar**

```bash
cd mobile && npx expo install expo-notifications expo-device
```

- [ ] **Passo 2: Criar `mobile/src/nativo/push.ts`**

```typescript
// mobile/src/nativo/push.ts
// Registro do aparelho para push. Grava na MESMA tabela push_subscriptions do
// web, com provider='fcm' e o token do dispositivo na coluna endpoint — é o que
// permite ao dispatch tratar navegador e app pelo mesmo caminho.
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import { supabase } from '../sessao/supabase'

export async function registrarPush(): Promise<void> {
  // Emulador não emite token válido; tentar gera erro sem informação.
  if (!Device.isDevice) return

  const { status: atual } = await Notifications.getPermissionsAsync()
  const status = atual === 'granted'
    ? atual
    : (await Notifications.requestPermissionsAsync()).status
  if (status !== 'granted') return

  const { data: tokenFcm } = await Notifications.getDevicePushTokenAsync()
  const { data: sessao } = await supabase.auth.getSession()
  const userId = sessao.session?.user.id
  if (!userId || typeof tokenFcm !== 'string') return

  // onConflict endpoint: reinstalar o app gera token novo, e reabrir com o
  // mesmo token não pode duplicar linha. Mesmo upsert do web.
  await supabase.from('push_subscriptions').upsert(
    { user_id: userId, endpoint: tokenFcm, provider: 'fcm', p256dh: null, auth: null },
    { onConflict: 'endpoint' },
  )
}

/** Toque na notificação: devolve o caminho a abrir, ou null. */
export function caminhoDaNotificacao(
  resposta: Notifications.NotificationResponse | null,
): string | null {
  const url = resposta?.notification.request.content.data?.url
  return typeof url === 'string' ? url : null
}
```

- [ ] **Passo 3: Chamar no layout raiz**

Em `mobile/app/_layout.tsx`, acrescentar o import:

```tsx
import { registrarPush } from '../src/nativo/push'
```

e, dentro do componente, um efeito que roda quando a sessão aparece:

```tsx
  useEffect(() => {
    // Só depois de logado: a linha em push_subscriptions precisa de user_id, e
    // a RLS exige que seja o do próprio usuário.
    if (sessao) registrarPush().catch(() => null)
  }, [sessao])
```

O `.catch(() => null)` é deliberado: push é best-effort em todo o projeto e recusar a permissão não pode impedir o app de funcionar.

- [ ] **Passo 4: Abrir a tela certa no toque da notificação**

Sem este passo, `caminhoDaNotificacao` fica sem consumidor e o toque continua caindo em `/home` — que é justamente a pendência que a Task 12 acabou de resolver do lado do servidor.

Criar `mobile/app/aberto.tsx`:

```tsx
// mobile/app/aberto.tsx
// Destino do toque em notificação: abre qualquer caminho do produto numa
// TelaWeb empilhada sobre as abas. Existe porque o deep-link aponta para
// caminhos que ainda não têm aba própria (ex.: /aulas/123).
import { useLocalSearchParams } from 'expo-router'
import { TelaWeb } from '../src/ponte/TelaWeb'

export default function Aberto() {
  const { caminho } = useLocalSearchParams<{ caminho?: string }>()
  return <TelaWeb caminho={caminho ?? '/home'} />
}
```

Em `mobile/app/_layout.tsx`, acrescentar os imports:

```tsx
import * as Notifications from 'expo-notifications'
import { caminhoDaNotificacao } from '../src/nativo/push'
```

e o efeito:

```tsx
  useEffect(() => {
    function abrir(resposta: Notifications.NotificationResponse | null) {
      const caminho = caminhoDaNotificacao(resposta)
      if (caminho) router.push({ pathname: '/aberto', params: { caminho } })
    }
    // App fechado: a notificação que o abriu chega por getLast…, não pelo
    // listener — que só existe a partir daqui.
    Notifications.getLastNotificationResponseAsync().then(abrir).catch(() => null)
    const sub = Notifications.addNotificationResponseReceivedListener(abrir)
    return () => sub.remove()
  }, [router])
```

- [ ] **Passo 5: Canal de notificação do Android em `mobile/app.json`**

Em `expo.plugins`:

```json
      [
        "expo-notifications",
        {
          "icon": "./assets/images/notification-icon.png",
          "color": "#ea580c"
        }
      ]
```

- [ ] **Passo 6: Verificar**

O registro de push **não funciona no Expo Go** — precisa do build da Task 18. Nesta tarefa, a verificação é só de compilação:

```bash
cd mobile && npx tsc --noEmit
```

Esperado: sem erro. A verificação de ponta a ponta vira um critério de aceite da Task 18.

- [ ] **Passo 7: Commit**

```bash
git add mobile
git commit -m "feat(mobile): registro do token FCM e deep-link no toque da notificacao"
```

---

## Task 15: Tranca biométrica e tela nativa de ajustes

**Files:**
- Create: `mobile/src/nativo/biometria.ts`
- Modify: `mobile/app/_layout.tsx`

- [ ] **Passo 1: Instalar**

```bash
cd mobile && npx expo install expo-local-authentication
```

- [ ] **Passo 2: Criar `mobile/src/nativo/biometria.ts`**

```typescript
// mobile/src/nativo/biometria.ts
// Tranca do app, NÃO login. A sessão do Supabase já persiste; isto só decide se
// a pessoa com o aparelho na mão pode ver o que já está logado. Desligada por
// padrão: ligar sozinho trancaria o app de quem não cadastrou digital.
import * as LocalAuthentication from 'expo-local-authentication'
import AsyncStorage from '@react-native-async-storage/async-storage'

const CHAVE = 'arenahub:tranca-biometrica'

export async function trancaLigada(): Promise<boolean> {
  return (await AsyncStorage.getItem(CHAVE)) === '1'
}

export async function definirTranca(ligada: boolean): Promise<void> {
  await AsyncStorage.setItem(CHAVE, ligada ? '1' : '0')
}

export async function biometriaDisponivel(): Promise<boolean> {
  const temHardware = await LocalAuthentication.hasHardwareAsync()
  const temCadastro = await LocalAuthentication.isEnrolledAsync()
  return temHardware && temCadastro
}

/** true quando pode seguir: tranca desligada, indisponível, ou autenticada. */
export async function desbloquear(): Promise<boolean> {
  if (!(await trancaLigada())) return true
  // Aparelho que perdeu o cadastro de digital não pode virar app inacessível.
  if (!(await biometriaDisponivel())) return true

  const r = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Desbloquear o ArenaHub',
    cancelLabel: 'Cancelar',
  })
  return r.success
}
```

- [ ] **Passo 3: Aplicar no layout raiz**

Em `mobile/app/_layout.tsx`, acrescentar o import:

```tsx
import { desbloquear } from '../src/nativo/biometria'
```

um estado:

```tsx
  const [desbloqueado, setDesbloqueado] = useState(false)
```

um efeito:

```tsx
  useEffect(() => {
    desbloquear().then(setDesbloqueado).catch(() => setDesbloqueado(true))
  }, [])
```

e a guarda, logo antes do `return` final:

```tsx
  if (sessao && !desbloqueado) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0c1220' }}>
        <ActivityIndicator color="#f97316" />
      </View>
    )
  }
```

- [ ] **Passo 4: Tela de Ajustes, para a tranca poder ser ligada**

Sem ela a tranca é código morto: nasce desligada e não existe caminho para ligar. Esta também é a **primeira tela inteiramente nativa** do app — e é o que a Task 19 usa como argumento de que o app não é "só um site".

Criar `mobile/app/ajustes.tsx`:

```tsx
// mobile/app/ajustes.tsx
// Ajustes do app (não do produto): o que é do aparelho mora aqui, o que é da
// conta continua no /perfil web. Primeira tela 100% nativa.
import { useEffect, useState } from 'react'
import { StyleSheet, Switch, Text, View } from 'react-native'
import { Stack } from 'expo-router'
import { biometriaDisponivel, definirTranca, trancaLigada } from '../src/nativo/biometria'

export default function Ajustes() {
  const [ligada, setLigada] = useState(false)
  const [disponivel, setDisponivel] = useState(false)

  useEffect(() => {
    trancaLigada().then(setLigada)
    biometriaDisponivel().then(setDisponivel)
  }, [])

  async function alternar(valor: boolean) {
    setLigada(valor)
    await definirTranca(valor)
  }

  return (
    <View style={estilos.tela}>
      <Stack.Screen options={{ title: 'Ajustes do app', headerStyle: { backgroundColor: '#151e31' }, headerTintColor: '#fff' }} />
      <View style={estilos.linha}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={estilos.rotulo}>Pedir digital ao abrir</Text>
          <Text style={estilos.ajuda}>
            {disponivel
              ? 'Protege o app se alguém pegar seu celular desbloqueado.'
              : 'Cadastre uma digital nas configurações do Android para usar.'}
          </Text>
        </View>
        <Switch value={ligada} onValueChange={alternar} disabled={!disponivel} trackColor={{ true: '#ea580c' }} />
      </View>
    </View>
  )
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: '#0c1220', padding: 16 },
  linha: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#151e31', borderRadius: 12, borderWidth: 1, borderColor: '#26334d', padding: 16 },
  rotulo: { color: '#fff', fontSize: 15, fontWeight: '600' },
  ajuda: { color: '#94a3b8', fontSize: 13, marginTop: 4 },
})
```

Dar acesso a ela pela aba Perfil. Em `mobile/app/(abas)/_layout.tsx`, acrescentar os imports:

```tsx
import { Link } from 'expo-router'
```

e trocar a linha do `Tabs.Screen` do perfil por:

```tsx
      <Tabs.Screen
        name="perfil"
        options={{
          title: 'Perfil',
          tabBarIcon: ({ color, size }) => <Feather name="user" color={color} size={size} />,
          headerShown: true,
          headerTitle: 'Perfil',
          headerStyle: { backgroundColor: '#151e31' },
          headerTintColor: '#fff',
          headerRight: () => (
            <Link href="/ajustes" style={{ marginRight: 16 }}>
              <Feather name="settings" color="#f97316" size={22} />
            </Link>
          ),
        }}
      />
```

- [ ] **Passo 5: Verificar**

`npx tsc --noEmit` sem erro. `npx expo start` e, no celular:

1. Aba Perfil mostra um cabeçalho com engrenagem.
2. A engrenagem abre "Ajustes do app".
3. Ligar a chave, fechar o app completamente e reabrir: o Android pede a digital.
4. Cancelar a digital mantém o app travado; autenticar libera.
5. Desligar a chave e reabrir: entra direto.

- [ ] **Passo 6: Commit**

```bash
git add mobile
git commit -m "feat(mobile): tranca biometrica e tela nativa de ajustes"
```

---

## Task 16: Atualização OTA

**Files:**
- Modify: `mobile/app.json`

- [ ] **Passo 1: Instalar e configurar**

```bash
cd mobile
npx expo install expo-updates
eas update:configure
```

- [ ] **Passo 2: Conferir `mobile/app.json`**

O comando acima acrescenta `expo.updates.url` e `expo.runtimeVersion`. Confirmar que existem. Acrescentar, dentro de `expo.updates`:

```json
      "checkAutomatically": "ON_LOAD",
      "fallbackToCacheTimeout": 3000
```

3 segundos: acima disso o aluno espera olhando splash em rede ruim, e a versão em cache resolve.

- [ ] **Passo 3: Commit**

```bash
git add mobile
git commit -m "feat(mobile): atualizacao OTA via expo-updates"
```

---

## Task 17: Identidade do app

**Files:**
- Modify: `mobile/app.json`
- Create: `mobile/assets/images/icon.png`, `adaptive-icon.png`, `splash.png`, `notification-icon.png`

- [ ] **Passo 1: Gerar os ícones a partir do que já existe**

O projeto tem `public/icons/icon-512x512.png`. Da raiz:

```bash
cp public/icons/icon-512x512.png mobile/assets/images/icon.png
cp public/icons/icon-512x512.png mobile/assets/images/adaptive-icon.png
cp public/icons/icon-512x512.png mobile/assets/images/notification-icon.png
```

O ícone de notificação do Android é renderizado como silhueta branca — se o resultado ficar um quadrado branco na Task 18, refazer esse arquivo como PNG transparente com o glifo em branco.

- [ ] **Passo 2: Escrever `mobile/app.json`**

```json
{
  "expo": {
    "name": "ArenaHub",
    "slug": "arenahub",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/images/icon.png",
    "scheme": "arenahub",
    "userInterfaceStyle": "dark",
    "backgroundColor": "#0c1220",
    "splash": {
      "image": "./assets/images/splash.png",
      "resizeMode": "contain",
      "backgroundColor": "#0c1220"
    },
    "android": {
      "package": "website.arenahub.app",
      "versionCode": 1,
      "adaptiveIcon": {
        "foregroundImage": "./assets/images/adaptive-icon.png",
        "backgroundColor": "#0c1220"
      },
      "permissions": ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION"],
      "googleServicesFile": "./google-services.json"
    },
    "plugins": [
      "expo-router",
      "expo-secure-store",
      ["expo-location", { "locationAlwaysAndWhenInUsePermission": "O ArenaHub usa sua localização para confirmar presença na aula." }],
      ["expo-notifications", { "icon": "./assets/images/notification-icon.png", "color": "#ea580c" }]
    ]
  }
}
```

**`website.arenahub.app` é irreversível depois do primeiro envio.** Conferir agora que bate exatamente com o que foi registrado no Firebase na Task 13.

- [ ] **Passo 3: Criar a splash**

Usar `public/logo.svg` sobre fundo `#0c1220`, exportado em 1284×2778. Qualquer editor serve.

- [ ] **Passo 4: Verificar**

```bash
cd mobile && npx expo prebuild --clean --platform android
```

Esperado: gera `mobile/android/` sem erro. Conferir que `mobile/android/app/build.gradle` traz `applicationId "website.arenahub.app"`.

- [ ] **Passo 5: Commit**

```bash
git add mobile
git commit -m "feat(mobile): identidade do app e package website.arenahub.app"
```

---

## Task 18: Build de produção pelo EAS

**Files:**
- Create: `mobile/eas.json`

- [ ] **Passo 1: Conta Expo e login**

Criar conta em https://expo.dev (gratuita). Depois:

```bash
cd mobile
npx eas login
npx eas build:configure
```

- [ ] **Passo 2: Ajustar `mobile/eas.json`**

O perfil `production` precisa gerar **AAB** (a Play Store não aceita mais APK para apps novos):

```json
{
  "cli": { "version": ">= 5.0.0" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal" },
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" }
    },
    "production": {
      "autoIncrement": true,
      "android": { "buildType": "app-bundle" }
    }
  },
  "submit": { "production": {} }
}
```

O perfil `preview` gera APK de propósito: é o que você instala direto no celular para testar antes de subir na loja.

- [ ] **Passo 3: Enviar o `google-services.json` ao EAS**

Ele está no `.gitignore`, então o EAS não o recebe pelo repositório:

```bash
npx eas secret:create --scope project --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json
```

- [ ] **Passo 4: Build de teste (APK)**

```bash
npx eas build --platform android --profile preview
```

O build roda na nuvem (10 a 20 min). Ao terminar, baixar o APK pelo link e instalar no celular.

- [ ] **Passo 5: Critérios de aceite no APK**

Cada item abaixo tem de passar. São as coisas que **não** dá para verificar no Expo Go:

1. O app abre com ícone e splash do ArenaHub.
2. Login funciona; fechar e reabrir continua logado.
3. As cinco abas abrem logadas, sem barra dupla.
4. O Android pede permissão de localização e o self check-in encontra a posição.
5. O app aparece em Configurações → Apps → ArenaHub → Notificações.
6. Existe uma linha nova em `push_subscriptions` com `provider = 'fcm'` para o usuário de teste. Conferir pelo SQL Editor:
   ```sql
   select user_id, provider, left(endpoint, 20) as token, created_at
   from push_subscriptions where provider = 'fcm' order by created_at desc limit 5;
   ```
7. Tocar num link de WhatsApp abre fora do app.
8. Em modo avião, a aba mostra "Sem conexão" com botão — não tela branca.

- [ ] **Passo 6: Build de produção (AAB)**

Só depois de todos os oito passarem:

```bash
npx eas build --platform android --profile production
```

Guardar o `.aab` gerado.

- [ ] **Passo 7: Commit**

```bash
git add mobile/eas.json
git commit -m "chore(mobile): perfis de build do EAS"
```

---

## Task 19: Assinatura do SaaS sem fluxo de compra dentro do app

Exigência de politica da spec: aula presencial e servico do mundo real e pode ser cobrada por Mercado Pago, mas **assinatura de software e bem digital** e o Google pode exigir o Play Billing. A contratacao continua no navegador — onde o dono da academia ja se cadastrou.

Esconder por CSS nao serve: o revisor do Google navega o app e a regra tem de valer no servidor.

**Files:**
- Create: `lib/app/dentroDoApp.ts`
- Create: `lib/app/dentroDoApp.test.ts`
- Modify: `mobile/src/ponte/TelaWeb.tsx`
- Modify: `app/(admin)/admin/assinatura/page.tsx`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `lib/app/dentroDoApp.test.ts`:

```typescript
// lib/app/dentroDoApp.test.ts
import { describe, it, expect } from 'vitest'
import { isAppUserAgent } from './dentroDoApp'

describe('isAppUserAgent', () => {
  it('reconhece o app pela marca no user agent', () => {
    expect(isAppUserAgent('Mozilla/5.0 (Linux; Android 14) Chrome/120 ArenaHubApp/1.0')).toBe(true)
  })

  it('navegador comum nao e o app', () => {
    expect(isAppUserAgent('Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36')).toBe(false)
  })

  // Requisicao sem header nao pode ser tratada como app: erraria para o lado
  // de esconder a compra de quem esta no navegador e quer assinar.
  it('sem user agent nao e o app', () => {
    expect(isAppUserAgent(null)).toBe(false)
    expect(isAppUserAgent('')).toBe(false)
  })
})
```

- [ ] **Passo 2: Rodar e ver falhar**

PowerShell: `npm run test:run -- lib/app/dentroDoApp.test.ts`

Esperado: FAIL — `Failed to resolve import "./dentroDoApp"`.

- [ ] **Passo 3: Implementar**

Criar `lib/app/dentroDoApp.ts`:

```typescript
// lib/app/dentroDoApp.ts
// "Esta requisicao veio de dentro do app nativo?" — respondida pelo user agent,
// que o WebView marca em mobile/src/ponte/TelaWeb.tsx.
//
// Serve para decisoes que TEM de valer no servidor, como nao oferecer compra de
// assinatura dentro do app (politica de pagamento do Google Play). Para ajuste
// so visual existe a classe .dentro-do-app, injetada no documento.
//
// Fail-closed do lado do navegador: UA ausente e tratado como navegador. Errar
// para o outro lado esconderia o botao de assinar de quem quer assinar.
export const MARCA_APP = 'ArenaHubApp'

export function isAppUserAgent(userAgent: string | null | undefined): boolean {
  return !!userAgent && userAgent.includes(MARCA_APP)
}
```

- [ ] **Passo 4: Rodar e ver passar**

PowerShell: `npm run test:run -- lib/app/dentroDoApp.test.ts`

Esperado: 3 testes passando.

- [ ] **Passo 5: Marcar o user agent no WebView**

Em `mobile/src/ponte/TelaWeb.tsx`, acrescentar a prop ao `<WebView>`:

```tsx
      applicationNameForUserAgent="ArenaHubApp/1.0"
```

- [ ] **Passo 6: Trocar o botao por um aviso na pagina de assinatura**

Em `app/(admin)/admin/assinatura/page.tsx`, acrescentar aos imports:

```typescript
import { headers } from 'next/headers'
import { isAppUserAgent } from '@/lib/app/dentroDoApp'
```

logo depois de `const ctx = await getStaffContext()`:

```typescript
  // Politica de pagamento do Google Play: assinatura de software e bem digital
  // e nao pode ser vendida fora do Play Billing dentro do app. A pagina segue
  // mostrando o estado da assinatura — so a compra sai.
  const noApp = isAppUserAgent(headers().get('user-agent'))
```

e trocar cada uso de `<SubscribeButton ... />` por:

```tsx
        {noApp ? (
          <div className="rounded-xl border border-surface-border bg-surface-card p-4 text-sm text-slate-300">
            <p className="font-semibold text-white">Assinatura pelo site</p>
            <p className="mt-1 text-slate-400">
              Para contratar ou trocar de plano, acesse arenahub.website pelo navegador do
              computador ou do celular.
            </p>
          </div>
        ) : (
          <SubscribeButton />
        )}
```

Conferir os argumentos reais do `<SubscribeButton>` no arquivo e preserva-los no ramo `else` — nao invente props.

- [ ] **Passo 7: Verificar**

PowerShell: `npm run test:run` — baseline + 17.

```bash
npm run build
```

E no celular: abrir `/admin/assinatura` dentro do app com um usuario admin. Esperado: o aviso, sem botao de assinar. Abrir a mesma pagina no Chrome do celular: o botao continua la.

- [ ] **Passo 8: Commit**

```bash
git add lib/app app/\(admin\)/admin/assinatura/page.tsx mobile
git commit -m "feat: assinatura do SaaS sem fluxo de compra dentro do app"
```

---

## Task 20: Ficha da loja e Data safety

Tarefa **do usuário**, no Play Console. Depende da verificação de identidade (Task 1) ter saído.

- [ ] **Passo 1: Ficha**

- **Título** (30 caracteres): `ArenaHub`
- **Descrição curta** (80): `Sua agenda de aulas, presença e ranking da arena — tudo num app.`
- **Descrição longa**: usar exatamente este texto.

```
O ArenaHub é o app da sua arena ou academia. Se você treina beach tennis, padel,
futevôlei, crossfit ou qualquer atividade com turmas e horários, é aqui que sua
rotina de treino acontece.

PARA QUEM TREINA
• Veja a grade de aulas da sua academia e o que você já tem marcado
• Reserve, cancele e remarque aula direto pelo celular
• Entre na fila de espera e seja avisado quando abrir vaga
• Confirme sua presença na quadra
• Acompanhe seus créditos, mensalidade e pagamentos
• Dispute a Liga da academia: pontos por presença, divisões, medalhas e ranking
• Inscreva-se nos torneios da sua arena

PARA QUEM ENSINA
• Faça a chamada da turma pelo celular
• Veja quem confirmou presença e quem faltou
• Acompanhe alunos, turmas e pagamentos

O ArenaHub é gratuito para o aluno. A academia é quem contrata a plataforma.
```

**Não prometa o que o app não faz.** Descrição que anuncia recurso inexistente é o motivo mais comum de reprovação — e o app desta fase ainda é majoritariamente web por dentro. Antes de colar, confira item a item que cada linha existe hoje; a Liga, por exemplo, nasce **desligada** por academia (`system_settings.liga_enabled`), então "dispute a Liga" só é honesto porque a funcionalidade existe e é a academia que decide ligar.

A última linha existe por causa da Task 19: ela deixa claro ao revisor que o app não vende software para o usuário final.

- [ ] **Passo 2: Recursos gráficos**

- Ícone: 512×512 PNG (usar `public/icons/icon-512x512.png`)
- Gráfico de destaque: 1024×500
- Capturas: no mínimo 2, entre 320px e 3840px. Tirar do próprio APK: home, agendar, Liga, chamada do professor.

- [ ] **Passo 3: Política de privacidade**

Informar a URL pública. O projeto tem `app/legal/[slug]` — **abrir a página e conferir** que ela cobre: localização (check-in), dados de cadastro, fotos enviadas ao mural e identificadores de push. Se não cobrir, atualizar o texto antes de informar a URL.

- [ ] **Passo 4: Data safety**

Declarar coleta de:

| Tipo | Por quê |
|---|---|
| Localização aproximada e precisa | Confirmação de presença por GPS |
| Nome, e-mail, telefone | Cadastro |
| Fotos | Mural da Liga e foto de perfil |
| ID de dispositivo | Push |
| Histórico de compra | Mensalidade e créditos |

Marcar que os dados são criptografados em trânsito e que o usuário pode pedir exclusão (o projeto já tem fila de exclusão LGPD em `/super-admin/exclusoes`).

**Declaração falsa aqui derruba o app.** Na dúvida, declarar.

- [ ] **Passo 5: Questionários obrigatórios**

Classificação de conteúdo, público-alvo (não é app para crianças — há dependentes, mas a conta é do responsável), anúncios (não), e o formulário de segurança de dados.

---

## Task 21: Teste fechado e os 12 testadores

- [ ] **Passo 1: Criar a faixa de teste fechado**

Play Console → Testes → Teste fechado → Criar faixa. Enviar o `.aab` da Task 18.

- [ ] **Passo 2: Lista de e-mails**

Criar a lista com **no mínimo 12 contas Google**. Não são 12 convites: são 12 pessoas que **instalam e mantêm instalado por 14 dias corridos**.

Sugestão de recrutamento: alunos reais de uma academia parceira. Eles são o público certo e ainda trazem retorno de uso — o que torna os 14 dias trabalho útil, não espera.

- [ ] **Passo 3: Distribuir o link**

O console gera um link de aceite. Cada testador precisa **aceitar o convite e instalar**.

- [ ] **Passo 4: Acompanhar**

O painel do teste fechado mostra quantos testadores estão ativos. **Se cair abaixo de 12 em qualquer dia, o contador reinicia.** Vale monitorar na primeira semana.

- [ ] **Passo 5: Durante os 14 dias**

Continuar subindo versões novas normalmente — não interrompe o contador. É aqui que o sub-projeto 2 começa.

- [ ] **Passo 6: Solicitar produção**

Passados os 14 dias com 12 ativos, o console libera o pedido de acesso à produção. A revisão do Google leva de alguns dias a duas semanas para o primeiro envio.

---

## Encerramento do sub-projeto 1

Antes de declarar a fase pronta:

- [ ] PowerShell: `npm run test:run` — baseline + **17** testes novos (5 da ponte de sessão, 5 do FCM, 4 do dispatch, 3 do `dentroDoApp`)
- [ ] `npm run build` — limpo
- [ ] `cd mobile && npx tsc --noEmit` — limpo
- [ ] Os oito critérios de aceite da Task 18 Passo 5, no APK
- [ ] Migration da Task 10 aplicada em produção
- [ ] `/admin/assinatura` sem botão de compra dentro do app, e com botão no navegador (Task 19)
- [ ] App em teste fechado com 12 testadores ativos

## Pendências deixadas de propósito

| Pendência | Onde é resolvida |
|---|---|
| `FCM_ACCESS_TOKEN` renovado por cron em vez de token manual | Sub-projeto 2 |
| Ponte de sessão no iOS (WKWebView não compartilha cookie com o `fetch`) | Fase iOS |
| Tela de ligar/desligar a tranca biométrica | Sub-projeto 5 (Perfil nativo) |
| Chamadores de `notifyUsers` passando `url` | Sub-projetos 3 a 6, um domínio por vez |
| `packages/dominio` | Sub-projeto 3, com o primeiro consumidor |
