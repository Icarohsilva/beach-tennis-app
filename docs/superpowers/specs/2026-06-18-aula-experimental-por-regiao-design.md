# Aula Experimental por Região — Design

**Data:** 2026-06-18
**Subsistema do meta-projeto ArenaHub (multi-tenant).** Faz parte da fase de "experiência/posicionamento", entre a Marca+Landing (concluída) e o Plano 3 (Cobrança SaaS).

## Contexto

O ArenaHub já é multi-tenant: cada academia/quadra é uma `organization` (com `slug`, `name`, `status`, `invite_code`). Falta a ponta de **aquisição de alunos**: hoje existe um fluxo `/experimental` que foi feito no mundo single-tenant e tem dois problemas:

1. **Vaza dados entre academias.** `app/experimental/page.tsx` usa `createAdminClient()` (service role, ignora RLS) e lê **todas** as `class_sessions` de **todas** as organizações sem filtrar por `organization_id`. Com mais de uma academia no banco, a página mistura horários de academias diferentes.
2. **Não tem descoberta por região.** É uma página única e global, sem nenhum conceito de "achar a arena perto de mim".

Este subsistema entrega o que a landing promete no botão **"Encontrar uma arena"**: o aluno descobre arenas por cidade/bairro/esporte e agenda uma aula experimental gratuita na arena escolhida — com os dados corretamente isolados por academia.

## Decisões tomadas no brainstorming

1. **Região = cidade + bairro (texto/seleção).** Sem GPS, sem geocoding, sem mapa. Cobre o Brasil e é rápido de entregar.
2. **Fluxo = diretório `/arenas` + página por academia `/arenas/[slug]`.** URLs limpas e compartilháveis. O `/experimental` genérico é aposentado.
3. **Visibilidade = opt-in ligado por padrão.** A vitrine vem ativada em academias novas, mas o admin pode desligar. A arena só aparece de fato quando a cidade estiver preenchida.
4. **Esporte = tags leves na organização.** A academia marca quais esportes oferece (array de tags). Sem mexer em turmas/sessões.
5. **Acesso a dados = Server Components + `createAdminClient` com filtro explícito por org** (Abordagem A). Segue o padrão já usado no `/experimental` atual, corrige o vazamento e tem o menor risco. RLS público para `anon` (B) e ISR/cache (C) ficam para planos futuros se necessário.

## Escopo

### 1. Modelo de dados

Nova migration `supabase/migrations/20260618xxxxxx_org_listing_fields.sql` adicionando à tabela `organizations`:

| Campo | Tipo | Propósito |
|---|---|---|
| `is_listed` | `boolean not null default true` | Toggle da vitrine (opt-in ligado por padrão) |
| `state` | `text` (nullable) | UF — ex. "SP" |
| `city` | `text` (nullable) | Cidade — eixo principal da busca |
| `neighborhood` | `text` (nullable) | Bairro — filtro secundário |
| `address_line` | `text` (nullable) | Endereço/referência exibido na página da arena |
| `sports` | `text[] not null default '{}'` | Tags de esporte para filtro (ex. `{beach_tennis,padel}`) |
| `whatsapp` | `text` (nullable) | Contato exibido na página pública (opcional) |

Migration usa `add column if not exists` para idempotência (padrão do projeto). Nenhum backfill obrigatório: a org #1 (Hudson) recebe `is_listed=true` por default, mas só aparece quando o admin preencher a cidade.

**Regra canônica de aparição no diretório:**
```
status = 'active' AND is_listed = true AND city IS NOT NULL
```

**Tipo `Organization`** em `types/index.ts` ganha os campos novos (todos opcionais/nullable conforme acima; `is_listed: boolean`, `sports: string[]`).

### 2. Constante de esportes

`lib/arenas/sports.ts`:
```ts
export interface Sport {
  slug: string   // 'beach_tennis'
  label: string  // 'Beach Tennis'
  emoji: string  // '🎾'
}

export const SPORTS: Sport[] = [
  { slug: 'beach_tennis', label: 'Beach Tennis', emoji: '🎾' },
  { slug: 'padel',        label: 'Padel',          emoji: '🟢' },
  { slug: 'futevolei',    label: 'Futevôlei',      emoji: '⚽' },
  { slug: 'volei_praia',  label: 'Vôlei de Praia', emoji: '🏐' },
  { slug: 'tenis',        label: 'Tênis',          emoji: '🎾' },
]

// Filtra a entrada do usuário contra a lista válida; remove duplicados e inválidos.
export function normalizeSports(input: string[]): string[]
```

Reusada no filtro do diretório e no formulário do admin. Sem tabela nova.

### 3. Filtro do diretório

`lib/arenas/filters.ts`:
```ts
export interface DirectoryQuery {
  cidade?: string
  esporte?: string
}

// Traduz os parâmetros da query string em critérios aplicáveis na consulta Supabase.
// Sem cidade e sem esporte → só os critérios base (active/listed/city not null).
export function buildDirectoryFilter(q: DirectoryQuery): {
  city?: string
  sport?: string
}
```

Função pura, testada no Vitest. Sanitiza/normaliza (trim, esporte válido).

### 4. Sessões abertas de uma arena

`lib/arenas/sessions.ts`:
```ts
export interface TrialSessionOption {
  id: string
  session_date: string
  class_name: string
  start_time: string
  end_time: string
  level: string
  spots_left: number
}

// Lista sessões dos próximos 30 dias de UMA org: status 'scheduled', turma ativa,
// type != 'kids', com vaga (max_students - bookings - trials > 0).
// TODA query escopada por .eq('organization_id', orgId).
export async function getOpenTrialSessions(orgId: string): Promise<TrialSessionOption[]>
```

Extrai a lógica hoje inline em `app/experimental/page.tsx`, agora escopada por org. Usa `createAdminClient`.

### 5. Rotas públicas

Todas Server Components com `export const dynamic = 'force-dynamic'`, lendo via `createAdminClient` com filtro explícito.

**`app/arenas/page.tsx` — diretório**
- Lê `organizations` com a regra canônica de aparição, ordenado por cidade e nome.
- Aplica `buildDirectoryFilter` a partir de `searchParams` (`?cidade=...&esporte=...`).
- Renderiza `ArenaFilters` (form GET) + grid de cards.
- Card: nome, cidade/bairro, chips de esporte, CTA "Ver horários" → `/arenas/[slug]`.
- Estado vazio: "Nenhuma arena encontrada nessa região."

**`app/arenas/ArenaFilters.tsx`**
- `<form method="get">` sem JS de busca: `<select>` de cidade (distinct das orgs listadas, passado por prop) + chips de esporte (de `SPORTS`). Submit recarrega a página com a query string.

**`app/arenas/[slug]/page.tsx` — página da arena**
- Resolve a org por `slug`. Retorna `notFound()` (404) se: não existe, `status != 'active'`, `is_listed = false`, ou `city IS NULL`.
- Cabeçalho: nome, endereço (`address_line`, bairro, cidade/UF), chips de esporte, WhatsApp (se houver).
- `getOpenTrialSessions(org.id)` para as sessões.
- Renderiza `TrialBookingForm` com o contexto da arena (orgId + sessões). Estado vazio igual ao atual ("Nenhuma sessão disponível nos próximos 30 dias").

### 6. Booking escopado por org

`createTrialBooking` é **movida** de `app/experimental/actions.ts` para `app/arenas/[slug]/actions.ts` (o `/experimental` deixa de ter página própria) e passa a:
- Receber `organizationId` além de `sessionId, name, email, phone`.
- Validar que a sessão pertence à org (`.eq('organization_id', organizationId)` ao buscar a sessão).
- Escopar as checagens de capacidade e duplicidade por org (as queries de `session_bookings` e `trial_bookings` ganham `.eq('organization_id', organizationId)`).
- Gravar `organization_id` no insert de `trial_bookings`.

Mantém as validações atuais: campos preenchidos, e-mail válido, turma ativa, não-kids, sem duplicado por e-mail na sessão, capacidade.

### 7. Config da vitrine no admin

A página `app/(admin)/admin/configuracoes/page.tsx` já existe (`requireOwner()` + `getCurrentOrgId()` + `SystemSettingsForm`). Adiciona um segundo bloco **"Vitrine pública"**.

- `page.tsx` passa a carregar também os campos da org (`name, is_listed, state, city, neighborhood, address_line, sports, whatsapp`) e renderiza `VitrineForm`.
- **`VitrineForm.tsx`** (client): toggle `is_listed`; inputs de UF, cidade, bairro, endereço, WhatsApp; chips multi-seleção de esporte (de `SPORTS`). Aviso quando `is_listed=true` e cidade vazia: "Preencha a cidade para a arena aparecer no diretório."
- **Action `updateOrgListing(formData)`** (`'use server'`):
  1. `requireOwner()`.
  2. `getCurrentOrgId()` — escopo garantido pelo servidor; **não** recebe org do cliente.
  3. Sanitiza: UF maiúscula, trim nos textos, `sports` via `normalizeSports`.
  4. `update organizations set ... where id = orgId` via `createAdminClient`.
  5. `revalidatePath('/admin/configuracoes')` e `revalidatePath('/arenas')`.

### 8. Aposentar `/experimental`

- `app/experimental/page.tsx` vira `redirect('/arenas')` (308 permanente).
- `app/page.tsx`: CTA "Encontrar uma arena" passa a apontar direto para `/arenas` (evita o salto do redirect). O redirect fica como rede de segurança para links externos antigos.
- `TrialBookingForm.tsx` é reaproveitado na página da arena (recebe o contexto da arena).

## Arquivos

**Novos**
- `supabase/migrations/20260618xxxxxx_org_listing_fields.sql`
- `lib/arenas/sports.ts` + `lib/arenas/sports.test.ts`
- `lib/arenas/filters.ts` + `lib/arenas/filters.test.ts`
- `lib/arenas/sessions.ts`
- `app/arenas/page.tsx`
- `app/arenas/ArenaFilters.tsx`
- `app/arenas/[slug]/page.tsx`
- `app/arenas/[slug]/actions.ts` (`createTrialBooking` movida de `app/experimental/actions.ts`)
- `app/(admin)/admin/configuracoes/VitrineForm.tsx`

**Modificados**
- `types/index.ts` — campos novos em `Organization`
- `app/experimental/page.tsx` — `redirect('/arenas')`
- `app/experimental/TrialBookingForm.tsx` — recebe contexto da arena (orgId)
- `app/page.tsx` — CTA → `/arenas`
- `app/(admin)/admin/configuracoes/page.tsx` — carrega campos da org + `VitrineForm`

## Testes

**Vitest (lógica pura)**
- `lib/arenas/sports.test.ts` — `normalizeSports`: descarta inválidos, deduplica, lida com vazio.
- `lib/arenas/filters.test.ts` — `buildDirectoryFilter`: sem filtro, só cidade, cidade + esporte, esporte inválido.

**Verificação por build + manual** (páginas/forms, igual ao padrão da landing)
- `npm run build` sem erros de tipo.
- `npm run test:run` segue verde (os 75 testes do app).

**Roteiro manual (isolamento é o mais importante)**
1. Admin da arena A liga a vitrine, preenche cidade/esportes → A aparece em `/arenas`.
2. Filtrar por cidade e por esporte → resultados corretos.
3. `/arenas/[slug]` de A mostra **só** sessões de A; agendar experimental funciona e **não** afeta B.
4. Arena com `is_listed=false` ou sem cidade → **não** aparece no diretório e `/arenas/[slug]` retorna 404.
5. `/experimental` redireciona para `/arenas`.
6. App da Academia Hudson Barros (org #1) continua funcionando após a migration.

## Fora de escopo (planos futuros)

- Geolocalização "perto de mim" (lat/lng + raio). O schema atual permite evoluir depois.
- Esporte como campo estrutural em turmas/sessões (filtro de sessões por esporte).
- SEO/ISR/cache estático do diretório.
- Fotos/galeria da arena, avaliações, ranking público.
- Cobrança do SaaS → Plano 3.
