# Alternância Aluno ↔ Super Admin — Design

Data: 2026-08-08

## Contexto

Um usuário pode acumular papéis: ser aluno de uma academia (ou de várias) e também ter
`profiles.is_platform_admin = true` (acesso ao painel de plataforma em `/super-admin`).
Hoje, quem está na visão de aluno e precisa checar o painel de plataforma não tem
atalho nenhum — precisa navegar por URL direta. O mesmo problema já foi resolvido para
outro papel acumulado: quem é `isStaff` da academia ativa (dono/professor) já vê um
badge **"Painel"** no header do dashboard do aluno, que leva a `/admin/dashboard`
(`app/(dashboard)/layout.tsx:105-112`, adicionado depois que "o admin que cai [na visão
de aluno, que é o `start_url` do PWA] não tinha caminho nenhum de volta a não ser sair
e entrar de novo, e parecia ter 'virado aluno'").

Esta spec estende exatamente esse padrão já existente para o papel de platform admin,
nas duas direções: aluno → super-admin e super-admin → aluno.

## Decisões

1. **Reaproveitar o badge "Painel" como template visual**, não criar componente novo.
   É código pequeno (um `<Link>` com uma classe Tailwind) usado em só 2 lugares —
   extrair um componente compartilhado seria abstração sem necessidade.
2. **Label do badge no dashboard do aluno: "Plataforma"** — ecoa o texto
   "ArenaHub · Plataforma" que já identifica o painel de super-admin no header dele
   próprio (`app/(super-admin)/layout.tsx:49-51`), então o aluno associa o nome antes
   mesmo de clicar.
3. **Label do badge no super-admin: "Aluno"**, indo para `/home`.
4. **Escopo do badge "Plataforma": só no dashboard do aluno**, não no painel admin da
   academia (`/admin/*`) — decisão do usuário durante o brainstorm, já que o caso de
   uso relatado é especificamente "uso esse usuário também como aluno".
5. **Sem gate de segurança novo.** `/super-admin` já redireciona quem não é platform
   admin (`app/(super-admin)/layout.tsx:25`) e cada server action do painel já
   re-verifica `is_platform_admin` (`features/super-admin/actions.ts`,
   `features/feedback/actions.ts`). Os dois badges são atalhos de navegação; a
   proteção real não muda.
6. **`isPlatformAdmin` lido junto com a query que já existe** — o dashboard do aluno
   já busca `profiles.tour_aluno_seen_at` para o tour; a mesma chamada ganha
   `is_platform_admin` na lista de colunas, sem round-trip extra.

## Arquitetura

### `app/(dashboard)/layout.tsx`

A query existente:
```tsx
const { data: tourProfile } = await supabase
  .from('profiles')
  .select('tour_aluno_seen_at')
  .eq('id', user.id)
  .single()
```
passa a selecionar também `is_platform_admin`. Uma constante `isPlatformAdmin =
tourProfile?.is_platform_admin === true` é derivada logo depois.

No header, dentro do mesmo `<div className="flex items-center gap-1">` onde já vive o
badge condicional `isStaff` → "Painel", entra o badge condicional `isPlatformAdmin` →
"Plataforma", com a mesma classe Tailwind do badge irmão (cor, padding, borda,
hover), apontando para `/super-admin`. Ordem: depois do badge "Painel" (se ambos
aparecerem, o mais específico ao contexto de academia vem primeiro), antes do
`HelpButton`.

Este uso de `supabase` (cliente com RLS, não `createAdminClient()`) para ler
`is_platform_admin` do próprio usuário é seguro e consistente com o resto da query
(`tour_aluno_seen_at` já é lido assim) — a policy de RLS de `profiles` já permite ao
usuário ler sua própria linha. Isso é diferente da checagem em
`app/(super-admin)/layout.tsx`, que usa `createAdminClient()` porque *é* o gate de
segurança (precisa ignorar RLS para ser a fonte da verdade); aqui é só para decidir se
mostra um atalho, então uma leitura com RLS bastando (e falhando fechado, escondendo o
botão) é aceitável.

### `app/(super-admin)/layout.tsx`

No grupo `<div className="flex shrink-0 items-center gap-3">` do header (onde já ficam
o nome do usuário e o `LogoutButton`), entra o badge "Aluno" com a mesma classe
Tailwind, apontando para `/home`, posicionado antes do `LogoutButton`.

## Fora de escopo

- Badge no painel admin da academia (`/admin/*`) para platform admins — não pedido.
- Botão de Ajuda no super-admin — não pedido, painel de plataforma não tem
  documentação própria hoje.
- Novo helper compartilhado tipo `isPlatformAdmin()` client-side — as duas leituras
  existentes (aqui e em `features/super-admin/actions.ts`) continuam inline, seguindo
  o padrão já estabelecido no projeto (nenhum helper compartilhado existe hoje para
  essa checagem; cada arquivo já refaz a query).

## Testes

Sem lógica de negócio nova isolável em função pura — é composição de JSX condicional
com um dado já buscado. Verificação manual via preview: logar como usuário com
`is_platform_admin = true` e pelo menos uma academia; confirmar que o badge
"Plataforma" aparece no dashboard do aluno e leva a `/super-admin`; confirmar que o
badge "Aluno" aparece lá e leva de volta a `/home`; confirmar que um usuário sem
`is_platform_admin` não vê o badge em nenhum lugar.
