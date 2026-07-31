# Espaço "Vídeo" (câmeras) via iframe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o item "Comunidade" do menu do aluno por "Vídeo", que abre em iframe (com fallback "abrir em nova aba") uma URL de site de câmeras configurável por academia em Admin > Configurações.

**Architecture:** Reaproveita a tabela `system_settings` (key/value por `organization_id`) e o server action `updateSystemSettings` já existentes para guardar `video_feed_url`. Nova rota `app/(dashboard)/video/` lê essa chave e renderiza um iframe (ou estado vazio se não configurada). `BottomNav.tsx` troca a entrada "Comunidade" por "Vídeo". A rota `/comunidade` e seus dados continuam existindo, só saem do menu.

**Tech Stack:** Next.js 14 App Router (Server Components + Server Actions), TypeScript, Supabase (`system_settings` table), Tailwind, lucide-react.

Spec de referência: [docs/superpowers/specs/2026-07-31-video-cameras-iframe-design.md](../specs/2026-07-31-video-cameras-iframe-design.md)

---

### Task 1: Trocar "Comunidade" por "Vídeo" no menu do aluno

**Files:**
- Modify: `components/ui/BottomNav.tsx`

- [ ] **Step 1: Editar o array de itens do menu e o import de ícones**

Em `components/ui/BottomNav.tsx`, troque a linha 5 e as linhas 8-13:

```tsx
import { Home, MapPin, Plus, Users, User } from 'lucide-react'
```
por:
```tsx
import { Home, MapPin, Plus, Video, User } from 'lucide-react'
```

e:
```tsx
const navItems = [
  { href: '/home', icon: Home, label: 'Home' },
  { href: '/torneios', icon: MapPin, label: 'Arena', dataTour: 'tour-aluno-arena' },
  { href: '/comunidade', icon: Users, label: 'Comunidade' },
  { href: '/perfil', icon: User, label: 'Perfil', dataTour: 'tour-aluno-perfil' },
]
```
por:
```tsx
const navItems = [
  { href: '/home', icon: Home, label: 'Home' },
  { href: '/torneios', icon: MapPin, label: 'Arena', dataTour: 'tour-aluno-arena' },
  { href: '/video', icon: Video, label: 'Vídeo' },
  { href: '/perfil', icon: User, label: 'Perfil', dataTour: 'tour-aluno-perfil' },
]
```

- [ ] **Step 2: Commit**

```bash
git add components/ui/BottomNav.tsx
git commit -m "feat(menu): trocar Comunidade por Vídeo no menu do aluno"
```

---

### Task 2: Aceitar `video_feed_url` no server action de configurações

**Files:**
- Modify: `features/financeiro/actions.ts:426-506` (função `updateSystemSettings`)

- [ ] **Step 1: Adicionar o campo ao tipo de entrada da função**

Em `features/financeiro/actions.ts`, na assinatura de `updateSystemSettings` (linha 426), adicione o campo:

```ts
export async function updateSystemSettings(settings: {
  credit_expiry_days?: number
  cancellation_window_hours?: number
  default_checkin_target?: number
  grid_auto_enabled?: boolean
  grid_auto_day?: number
  grid_auto_hour?: number
  pix_key?: string
  pix_key_owner?: string
  debt_block_grace_days?: number
  quota_enforcement_enabled?: boolean
  max_classes_per_day?: number
  video_feed_url?: string
}): Promise<{ error?: string }> {
```

- [ ] **Step 2: Adicionar a validação da URL**

Logo depois do bloco de validação de `max_classes_per_day` (antes do comentário `// system_settings é key/value por academia...`, por volta da linha 490), adicione:

```ts
  if (
    settings.video_feed_url !== undefined &&
    settings.video_feed_url !== '' &&
    !/^https?:\/\//i.test(settings.video_feed_url)
  ) {
    return { error: 'URL do site de vídeos deve começar com http:// ou https://.' }
  }
```

Como `video_feed_url` já é string, o mapeamento existente para `rows` (`Object.entries(settings).filter(([, v]) => v !== undefined).map(...)`) já cobre esse campo sem mudança adicional — string vazia é salva como está e tratada como "não configurada" pela tela do aluno (Task 4).

- [ ] **Step 3: Rodar o build para garantir que não há erro de tipo**

Run: `npm run build`
Expected: build conclui sem erros de TypeScript relacionados a `features/financeiro/actions.ts`.

- [ ] **Step 4: Commit**

```bash
git add features/financeiro/actions.ts
git commit -m "feat(config): aceitar video_feed_url em updateSystemSettings"
```

---

### Task 3: Formulário de admin para a URL de vídeos

**Files:**
- Create: `app/(admin)/admin/configuracoes/VideoFeedUrlForm.tsx`

- [ ] **Step 1: Criar o componente do formulário**

```tsx
'use client'
// app/(admin)/admin/configuracoes/VideoFeedUrlForm.tsx
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { updateSystemSettings } from '@/features/financeiro/actions'

interface Props {
  videoFeedUrl: string
}

export function VideoFeedUrlForm({ videoFeedUrl }: Props) {
  const [url, setUrl] = useState(videoFeedUrl)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    const trimmed = url.trim()
    if (trimmed !== '' && !/^https?:\/\//i.test(trimmed)) {
      setError('A URL deve começar com http:// ou https://.')
      return
    }

    startTransition(async () => {
      const result = await updateSystemSettings({ video_feed_url: trimmed })
      if (result.error) {
        setError(result.error)
      } else {
        setSuccess('URL do site de vídeos salva com sucesso.')
      }
    })
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        {success && (
          <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">
            {success}
          </p>
        )}

        <div className="space-y-1">
          <label className="text-sm text-slate-300 font-medium">
            URL do site de vídeos/câmeras
          </label>
          <p className="text-xs text-slate-400">
            Cole o link da tela de login do sistema de câmeras. Os alunos verão essa página
            dentro do app, na aba Vídeo. Deixe em branco para ocultar essa aba do aluno.
          </p>
          <Input
            type="url"
            placeholder="https://..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>

        <Button type="submit" variant="primary" loading={pending}>
          Salvar URL de vídeos
        </Button>
      </form>
    </Card>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add "app/(admin)/admin/configuracoes/VideoFeedUrlForm.tsx"
git commit -m "feat(admin): formulário de URL do site de vídeos"
```

---

### Task 4: Ligar o formulário na página de Configurações

**Files:**
- Modify: `app/(admin)/admin/configuracoes/page.tsx`

- [ ] **Step 1: Importar o componente**

Adicione ao bloco de imports (perto da linha 5):

```tsx
import { VideoFeedUrlForm } from './VideoFeedUrlForm'
```

- [ ] **Step 2: Ler o valor salvo**

Logo depois da linha `const cobranca = {...}` (por volta da linha 52), adicione:

```tsx
  const videoFeedUrl = map.get('video_feed_url') ?? ''
```

- [ ] **Step 3: Renderizar a seção**

Entre o bloco `<CobrancaForm settings={cobranca} />` e o título "Personalização" (por volta da linha 114), adicione:

```tsx
      <div>
        <h2 className="text-lg font-bold text-white">Vídeo das quadras</h2>
        <p className="text-slate-400 text-sm mt-1">
          URL do site de câmeras/gravações que os alunos acessam pela aba Vídeo.
        </p>
      </div>
      <VideoFeedUrlForm videoFeedUrl={videoFeedUrl} />
```

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/admin/configuracoes/page.tsx"
git commit -m "feat(admin): exibir formulário de URL de vídeos em Configurações"
```

---

### Task 5: Rota `/video` no dashboard do aluno

**Files:**
- Create: `app/(dashboard)/video/page.tsx`
- Create: `app/(dashboard)/video/VideoClient.tsx`

- [ ] **Step 1: Criar o Server Component da rota**

```tsx
// app/(dashboard)/video/page.tsx
export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { VideoClient } from './VideoClient'

export default async function VideoPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()

  const { data: row } = await adminClient
    .from('system_settings')
    .select('value')
    .eq('organization_id', orgId)
    .eq('key', 'video_feed_url')
    .maybeSingle()

  return <VideoClient videoFeedUrl={row?.value ?? null} />
}
```

- [ ] **Step 2: Criar o Client Component com iframe, fallback e estado vazio**

```tsx
'use client'
// app/(dashboard)/video/VideoClient.tsx

import { SectionHeader } from '@/components/ui/SectionHeader'
import { Card } from '@/components/ui/Card'

interface VideoClientProps {
  videoFeedUrl: string | null
}

export function VideoClient({ videoFeedUrl }: VideoClientProps) {
  const hasUrl = !!videoFeedUrl

  return (
    <div className="relative min-h-full pb-24">
      <div className="sticky top-0 z-10 bg-surface border-b border-surface-border px-4 py-3">
        <SectionHeader title="Vídeo" />
      </div>

      <div className="px-4 py-4 space-y-3">
        {!hasUrl ? (
          <Card>
            <p className="text-sm text-slate-300">
              Vídeos ainda não configurados. Peça ao administrador da academia para configurar
              em Configurações.
            </p>
          </Card>
        ) : (
          <>
            <a
              href={videoFeedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-sm text-brand-500 hover:text-brand-400 transition-colors"
            >
              Abrir em nova aba →
            </a>
            <iframe
              src={videoFeedUrl}
              className="w-full h-[75vh] rounded-xl border border-surface-border bg-surface-card"
              sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
              title="Vídeos das quadras"
            />
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/video/page.tsx" "app/(dashboard)/video/VideoClient.tsx"
git commit -m "feat(video): nova rota /video com iframe do site de câmeras"
```

---

### Task 6: Verificação manual no navegador

Sem lógica de negócio isolável em função pura aqui (é composição de Server/Client Component + iframe) — a verificação é funcional, via preview.

**Files:** nenhum (só verificação)

- [ ] **Step 1: Subir o dev server e abrir o dashboard do aluno**

Use a ferramenta de preview do projeto para rodar `npm run dev` e abrir `http://localhost:3000/home` logado como aluno. Confirme que o menu inferior mostra **Home · Arena · (+) · Vídeo · Perfil** (sem "Comunidade").

- [ ] **Step 2: Testar o estado vazio**

Sem `video_feed_url` configurado, abra `/video`: deve aparecer o card "Vídeos ainda não configurados...".

- [ ] **Step 3: Configurar uma URL de teste**

Como admin, abra `/admin/configuracoes`, preencha "URL do site de vídeos/câmeras" com uma URL de teste (ex.: `https://example.com`) e salve. Confirme a mensagem de sucesso.

- [ ] **Step 4: Testar o iframe**

Volte como aluno em `/video`: o iframe deve carregar a URL configurada, e o link "Abrir em nova aba" deve abrir a mesma URL numa nova guia.

- [ ] **Step 5: Confirmar que `/comunidade` continua acessível directly**

Acesse `/comunidade` diretamente pela barra de endereço (sem link no menu): o feed social deve continuar funcionando normalmente.

---

### Task 7: Corrigir CLAUDE.md

**Files:**
- Modify: `CLAUDE.md:80`

- [ ] **Step 1: Remover a menção desatualizada a "comunidade"**

Troque:
```markdown
The `features/` directory (aulas, financeiro, comunidade, torneios) and most dashboard pages are planned for Plan 2+. Most `app/(dashboard)/` pages currently show placeholder text. The spec is at [docs/superpowers/specs/2026-05-31-beach-tennis-app-design.md](docs/superpowers/specs/2026-05-31-beach-tennis-app-design.md).
```
por:
```markdown
The `features/` directory (aulas, financeiro, torneios) and most dashboard pages are planned for Plan 2+. Most `app/(dashboard)/` pages currently show placeholder text. The spec is at [docs/superpowers/specs/2026-05-31-beach-tennis-app-design.md](docs/superpowers/specs/2026-05-31-beach-tennis-app-design.md). Comunidade (`features/comunidade/`) já está implementada (feed social), mas saiu do menu do aluno em favor de "Vídeo" — ver [docs/superpowers/specs/2026-07-31-video-cameras-iframe-design.md](docs/superpowers/specs/2026-07-31-video-cameras-iframe-design.md).
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: corrigir CLAUDE.md sobre status da Comunidade e novo espaço Vídeo"
```

---

### Task 8: Atualizar o Manual do Aluno (`docs/faq/aluno.md`)

**Files:**
- Modify: `docs/faq/aluno.md`

- [ ] **Step 1: Atualizar a introdução (linha 4)**

Troque:
```markdown
> Cobre do zero: **cadastro pelo link da academia (ou senha temporária) → primeiro acesso → agendar aulas, day use, financeiro, comunidade, torneios e perfil.**
```
por:
```markdown
> Cobre do zero: **cadastro pelo link da academia (ou senha temporária) → primeiro acesso → agendar aulas, day use, financeiro, vídeos das quadras, torneios e perfil.**
```

- [ ] **Step 2: Atualizar a menção à barra inferior na introdução (linha 9)**

Troque:
```markdown
**Onde usar:** o app do aluno é feito para o **celular** (PWA instalável). A navegação fica na **barra inferior**: Home · Arena · (+) · Comunidade · Perfil.
```
por:
```markdown
**Onde usar:** o app do aluno é feito para o **celular** (PWA instalável). A navegação fica na **barra inferior**: Home · Arena · (+) · Vídeo · Perfil.
```

- [ ] **Step 3: Atualizar o índice (linha 27)**

Troque:
```markdown
7. [Comunidade](#7-comunidade)
```
por:
```markdown
7. [Vídeo](#7-vídeo)
```

- [ ] **Step 4: Atualizar a menção à barra inferior na seção Home (linha 135)**

Troque:
```markdown
- **Barra inferior:** Home · Arena · **(+)** · Comunidade · Perfil. O botão **(+)** central é o atalho para agendar.
```
por:
```markdown
- **Barra inferior:** Home · Arena · **(+)** · Vídeo · Perfil. O botão **(+)** central é o atalho para agendar.
```

- [ ] **Step 5: Substituir a seção 7 (linhas 204-211)**

Troque:
```markdown
## 7. Comunidade

A aba **Comunidade** é o feed social da sua academia.

![Comunidade](images/aluno-comunidade.png)

Poste novidades, fotos e recados para a turma. Se ninguém postou ainda, você pode ser o primeiro (**Seja o primeiro a compartilhar com a galera**). Use o **(+)** para criar um post.

---
```
por:
```markdown
## 7. Vídeo

A aba **Vídeo** abre as gravações das câmeras das quadras da sua academia, direto na tela de
login do site de vídeos configurado pela academia.

![Vídeo](images/aluno-video.png)

Faça login com as credenciais do próprio site de vídeos (o ArenaHub só exibe a página, não
guarda essa senha). Se aparecer o aviso **"Vídeos ainda não configurados"**, é porque a
academia ainda não cadastrou a URL em Configurações — fale com ela. Se a página não carregar
dentro do app, use o botão **Abrir em nova aba**.

> **🔧 Nos bastidores**
> - A URL fica salva em `system_settings` (chave `video_feed_url`), uma por academia. O app só
>   monta um `<iframe>` apontando pra ela — não há integração de login entre os dois sistemas.

---
```

- [ ] **Step 6: Atualizar o resumo do fluxo (linha 256)**

Troque:
```markdown
6. Participar da **Comunidade** e dos **Torneios**.
```
por:
```markdown
6. Assistir aos **vídeos das quadras** e participar dos **Torneios**.
```

- [ ] **Step 7: Commit**

```bash
git add docs/faq/aluno.md
git commit -m "docs(faq): atualizar Manual do Aluno com a aba Vídeo no lugar de Comunidade"
```

---

### Task 9: Atualizar o Manual da Academia (`docs/faq/academia.md`)

**Files:**
- Modify: `docs/faq/academia.md:412-428` (seção 13, Configurações)

- [ ] **Step 1: Adicionar o bloco de Vídeo à lista de "Principais blocos"**

Troque:
```markdown
Principais blocos:

- **Regras de crédito/reposição:** validade dos créditos de reposição (dias), janela de cancelamento com reposição (horas — padrão 5h), meta mensal de check-ins de parceiro.
- **Personalização:** logo da academia, cor da marca e **prévia** (com botão de **Agendar aula** para simular a marca).
- **Vitrine pública:** dados que aparecem no diretório público (CEP, endereço, WhatsApp, esportes oferecidos, flag "aparecer no diretório").
- **Torneios:** descontos progressivos para inscrições múltiplas na mesma semana (2º e 3º torneio).

> **🔧 Nos bastidores**
> - A janela de cancelamento (padrão **5h**) alimenta `canCancelWithRefund()` em `lib/utils/creditRules.ts`: cancelou dentro da janela → recebe crédito de reposição; fora dela → perde o crédito.
> - A validade do crédito de reposição alimenta `getMakeupCreditExpiry()`.
```
por:
```markdown
Principais blocos:

- **Regras de crédito/reposição:** validade dos créditos de reposição (dias), janela de cancelamento com reposição (horas — padrão 5h), meta mensal de check-ins de parceiro.
- **Personalização:** logo da academia, cor da marca e **prévia** (com botão de **Agendar aula** para simular a marca).
- **Vitrine pública:** dados que aparecem no diretório público (CEP, endereço, WhatsApp, esportes oferecidos, flag "aparecer no diretório").
- **Torneios:** descontos progressivos para inscrições múltiplas na mesma semana (2º e 3º torneio).
- **Vídeo das quadras:** URL do site externo de câmeras/gravações que o aluno acessa pela aba **Vídeo**. Deixe em branco para esconder essa aba do aluno.

> **🔧 Nos bastidores**
> - A janela de cancelamento (padrão **5h**) alimenta `canCancelWithRefund()` em `lib/utils/creditRules.ts`: cancelou dentro da janela → recebe crédito de reposição; fora dela → perde o crédito.
> - A validade do crédito de reposição alimenta `getMakeupCreditExpiry()`.
> - A URL de vídeos fica em `system_settings` (chave `video_feed_url`), uma por academia — o app do aluno só monta um `<iframe>` com ela, sem integração de login entre os sistemas.
```

- [ ] **Step 2: Commit**

```bash
git add docs/faq/academia.md
git commit -m "docs(faq): documentar configuração de URL de vídeos no Manual da Academia"
```

---

### Task 10: Atualizar o script de captura de telas

**Files:**
- Modify: `docs/faq/capture.mjs:305`

- [ ] **Step 1: Trocar a captura de `/comunidade` por `/video`**

Troque:
```js
await capture(stu, '/comunidade', 'aluno-comunidade')
```
por:
```js
await capture(stu, '/video', 'aluno-video')
```

- [ ] **Step 2: Commit**

```bash
git add docs/faq/capture.mjs
git commit -m "docs(faq): capturar tela /video no lugar de /comunidade"
```

- [ ] **Step 3 (manual, feito pelo usuário depois — não rodar automaticamente):**

Rodar `npm run dev` e depois `node docs/faq/capture.mjs` para regenerar os prints. **Atenção:** esse script cria uma academia e usuários de teste reais no Supabase conectado (prefixo "FAQ Demo") — rode conscientemente, não como parte de uma automação silenciosa. Depois de gerar `docs/faq/images/aluno-video.png`, copiar para `public/faq/images/aluno-video.png` (rota `/ajuda/[manual]` serve as imagens de lá). Remover os arquivos órfãos `docs/faq/images/aluno-comunidade.png` e `public/faq/images/aluno-comunidade.png`, que não são mais referenciados por nenhum manual.

---

### Task 11: Checagem final

**Files:** nenhum

- [ ] **Step 1: Rodar o lint**

Run: `npm run lint`
Expected: sem erros novos.

- [ ] **Step 2: Rodar a suíte de testes (via PowerShell, não Bash — `test:run` via Bash é instável neste projeto)**

Run (PowerShell): `npm run test:run`
Expected: todos os testes passam (nenhum teste novo foi criado nesta feature, mas a suíte existente não pode quebrar).

- [ ] **Step 3: Rodar o build de produção**

Run: `npm run build`
Expected: build completo sem erros de tipo ou de rota.
