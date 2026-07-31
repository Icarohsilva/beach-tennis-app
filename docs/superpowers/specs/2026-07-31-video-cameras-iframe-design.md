# Espaço "Vídeo" (câmeras das quadras) via iframe — Design

Data: 2026-07-31

## Contexto

Algumas quadras têm sistema de câmeras que grava os jogos. O provedor desse sistema
disponibiliza um site próprio (com login) onde o aluno assiste aos vídeos. Queremos
expor esse site dentro do app, dentro de um iframe, no lugar do item "Comunidade" do
menu do dashboard do aluno.

O item "Comunidade" hoje já é um feed social funcional (posts, curtidas, comentários —
ver `features/comunidade/` e `app/(dashboard)/comunidade/`), ao contrário do que o
CLAUDE.md descreve ("planned for Plan 2+"). Essa mudança apenas remove o acesso pelo
menu; o código e os dados da Comunidade continuam existindo, a rota `/comunidade`
permanece no ar (sem link no menu).

O app é multi-tenant (`organization_id` em quase todas as tabelas — cada academia é
uma organização). Cada academia pode ter um provedor de câmera diferente, então a URL
do site de vídeos deve ser configurável por academia, não global.

## Decisões

1. **Comunidade sai do menu, não é removida do código.** `BottomNav` passa a ter
   "Vídeo" no lugar de "Comunidade". `/comunidade` continua acessível via URL direta,
   mas sem link.
2. **URL configurável por academia**, usando a tabela `system_settings`
   (key/value por `organization_id`) que já existe e já tem UI de admin
   (`SystemSettingsForm`/`GridAutoForm`). Nova chave: `video_feed_url`.
3. **"Login automático" = abrir direto na tela de login do site externo**, sem
   autenticação real integrada. O aluno digita as próprias credenciais dentro do
   iframe. Não guardamos nem injetamos senha nenhuma do site externo.
4. **Fallback para bloqueio de iframe.** Muitos sites de terceiros (portais de
   câmera/NVR, por exemplo) bloqueiam ser exibidos em iframe via
   `X-Frame-Options`/CSP do próprio site. A página sempre mostra um botão/link
   "Abrir em nova aba" com a mesma URL, visível independente do iframe carregar ou não.

## Arquitetura

### Dados

- Sem migration nova. Reaproveita `system_settings (organization_id, key, value)`.
- Nova chave: `video_feed_url` (string, URL completa incluindo protocolo).
- Sem valor configurado = funcionalidade some com estado vazio (ver abaixo), não erro.

### Rota do aluno

- Nova página `app/(dashboard)/video/page.tsx` (Server Component):
  - Resolve `organization_id` da sessão do usuário autenticado.
  - Busca `system_settings` filtrando `key = 'video_feed_url'` e
    `organization_id` da academia atual.
  - Passa o valor (ou `null`) para `VideoClient.tsx` (Client Component).
- `VideoClient.tsx`:
  - Se `url` for `null`/vazio: estado vazio — "Vídeos ainda não configurados. Peça
    ao administrador da academia para configurar em Configurações."
  - Se `url` existir: renderiza `<iframe src={url} sandbox="allow-forms
    allow-scripts allow-same-origin allow-popups" />` ocupando a área de conteúdo
    (abaixo do header, acima do `BottomNav`), com um botão "Abrir em nova aba"
    (`<a href={url} target="_blank" rel="noopener noreferrer">`) sempre visível
    acima ou abaixo do iframe.
- Nenhuma CSP própria do projeto bloqueia isso hoje (confirmado: não há
  `frame-src`/CSP configurado em `next.config.js` nem `middleware.ts`). Qualquer
  bloqueio viria do lado do site externo — daí o botão de fallback.

### Menu (`components/ui/BottomNav.tsx`)

Trocar:
```js
{ href: '/comunidade', icon: Users, label: 'Comunidade' }
```
por:
```js
{ href: '/video', icon: Video, label: 'Vídeo' }
```
(ícone `Video` do `lucide-react`). Resto do array (`Home`, `Arena`, `Perfil`)
permanece igual.

### Admin (`app/(admin)/admin/configuracoes/`)

- Adicionar `video_feed_url` à definição de campos usada por
  `SystemSettingsForm`/`GridAutoForm`, seguindo o mesmo padrão dos demais campos
  key/value já existentes ali (mecanismo exato a confirmar lendo o arquivo na hora
  de implementar).
- Rótulo: "URL do site de vídeos/câmeras". Texto de ajuda: "Cole o link da tela de
  login do sistema de câmeras. Os alunos verão essa página dentro do app."
- Campo tipo texto/URL simples, sem validação de formato além de campo vazio
  permitido (funcionalidade fica com estado vazio pro aluno até ser preenchido).

## Fora de escopo

- Autenticação/SSO real entre o app e o site de vídeos (exigiria suporte do
  provedor externo — não confirmado que existe).
- Remoção de dados ou rotas da Comunidade — só sai do menu.
- Suporte a múltiplos links de vídeo por academia (uma URL só por organização).

## Testes / verificação

Sem regra de negócio complexa que justifique teste unitário novo. Verificação via
preview manual:
1. `/video` sem `video_feed_url` configurado → estado vazio aparece.
2. Configurar uma URL de teste em Admin > Configurações → `/video` carrega o
   iframe e o botão "Abrir em nova aba" funciona.
3. Menu do dashboard mostra "Vídeo" no lugar de "Comunidade"; `/comunidade`
   continua acessível diretamente por URL.

## Documentação a atualizar (convenção do projeto)

- `docs/marketing/capture-prints.mjs` e prints correspondentes.
- Manuais `academia.md` (fluxo do admin) e `aluno.md` (fluxo do aluno), servidos
  em `/ajuda/[manual]`.
- `CLAUDE.md`, seção "Planned but Not Yet Implemented": remover/corrigir a menção
  a "comunidade" como não implementada (já estava desatualizada antes desta
  mudança).
