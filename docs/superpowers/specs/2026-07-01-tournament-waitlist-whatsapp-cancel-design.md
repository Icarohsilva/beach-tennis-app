# Tournament Waitlist, WhatsApp & Cancel — Design Spec

## Goal

Três melhorias interconectadas no módulo de torneios:
1. **Link WhatsApp** no card admin para cobrar pagamento de inscritos pendentes
2. **Cancelar por falta de pagamento** — action admin que remove a entry e promove lista de espera
3. **Limite de vagas + lista de espera** — `max_players` por torneio, promoção automática em 48h com confirmação do jogador

## Architecture

Abordagem A: `entry_status` na tabela existente `tournament_entries` + lazy expiry (sem cron job).

- Funções puras em `lib/torneios/waitlist.ts` (testáveis com Vitest)
- Helper interno `expireAndPromote` chamado por toda action que remove entry
- Promoção: `waitlist → offered` com `offer_expires_at = now() + 48h`
- Expiração: verificada lazily na action `confirmWaitlistOffer` e em `expireAndPromote`
- Contagem de vagas: `confirmed + offered` (offered reserva a vaga enquanto aguarda confirmação)

## Tech Stack

Next.js 14 App Router · TypeScript · Supabase (Postgres) · Vitest · Tailwind CSS

---

## 1. Schema

### `tournaments` — nova coluna

```sql
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS max_players integer;
-- null = sem limite de vagas
```

### `tournament_entries` — novas colunas

```sql
ALTER TABLE tournament_entries
  ADD COLUMN IF NOT EXISTS entry_status text NOT NULL DEFAULT 'confirmed'
    CHECK (entry_status IN ('confirmed', 'waitlist', 'offered')),
  ADD COLUMN IF NOT EXISTS offer_expires_at timestamptz;
-- offer_expires_at preenchido quando entry_status = 'offered'; null nos demais
```

Entradas existentes recebem `entry_status = 'confirmed'` pelo DEFAULT — sem backfill necessário.

### Semântica dos status

| entry_status | Significado | payment_status permitido |
|---|---|---|
| `confirmed` | Inscrito, ocupa vaga | `free` / `pending` / `paid` |
| `waitlist` | Na fila, sem vaga ainda | sempre `free` |
| `offered` | Vaga oferecida, 48h para confirmar | sempre `free` |

**Transição ao confirmar oferta:**
- Torneio gratuito: `entry_status → 'confirmed'`, `payment_status` permanece `'free'`
- Torneio pago: `entry_status → 'confirmed'`, `payment_status → 'pending'` (jogador agora precisa pagar)

---

## 2. Funções puras — `lib/torneios/waitlist.ts`

```ts
/**
 * Quantas vagas ainda disponíveis.
 * confirmedCount = COUNT(entry_status IN ('confirmed', 'offered'))
 * Retorna Infinity quando maxPlayers é null (sem limite).
 */
export function availableSlots(
  confirmedCount: number,
  maxPlayers: number | null,
): number {
  if (maxPlayers === null) return Infinity
  return Math.max(0, maxPlayers - confirmedCount)
}

/**
 * Retorna true se a oferta de vaga já venceu.
 */
export function isOfferExpired(offerExpiresAt: string | null): boolean {
  if (!offerExpiresAt) return false
  return new Date(offerExpiresAt) < new Date()
}

/**
 * Monta URL do WhatsApp com mensagem pré-preenchida.
 * Remove caracteres não numéricos e adiciona DDI 55 se ausente.
 */
export function buildWhatsAppUrl(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, '')
  const intl = digits.startsWith('55') ? digits : `55${digits}`
  return `https://wa.me/${intl}?text=${encodeURIComponent(message)}`
}
```

Testes colocados em `lib/torneios/waitlist.test.ts` cobrindo:
- `availableSlots`: null (retorna Infinity), cheio (retorna 0), com vagas (retorna n)
- `isOfferExpired`: null, no futuro, no passado
- `buildWhatsAppUrl`: telefone sem DDI, com DDI, com formatação (parênteses/hífen)

---

## 3. Helper interno — `expireAndPromote`

Função **não exportada** em `features/torneios/actions.ts`. Chamada por toda action que remove uma entry.

```ts
async function expireAndPromote(
  adminClient: ReturnType<typeof createAdminClient>,
  tournamentId: string,
  maxPlayers: number | null,
): Promise<void> {
  if (!maxPlayers) return // sem limite, nada a fazer

  // 1. Expirar entradas 'offered' com prazo vencido → volta para 'waitlist'
  await adminClient
    .from('tournament_entries')
    .update({ entry_status: 'waitlist', offer_expires_at: null })
    .eq('tournament_id', tournamentId)
    .eq('entry_status', 'offered')
    .lt('offer_expires_at', new Date().toISOString())

  // 2. Contar vagas ocupadas (confirmed + offered restantes)
  const { count: occupiedCount } = await adminClient
    .from('tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .in('entry_status', ['confirmed', 'offered'])

  const available = maxPlayers - (occupiedCount ?? 0)
  if (available <= 0) return

  // 3. Promover os N mais antigos da fila para 'offered'
  const offerExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
  const { data: toPromote } = await adminClient
    .from('tournament_entries')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('entry_status', 'waitlist')
    .order('created_at', { ascending: true })
    .limit(available)

  if (!toPromote?.length) return

  await adminClient
    .from('tournament_entries')
    .update({ entry_status: 'offered', offer_expires_at: offerExpiresAt })
    .in('id', toPromote.map((e) => e.id))
}
```

---

## 4. Server actions

### 4.1 `registerForTournament` + `registerExternal` (modificar)

Antes do INSERT, verificar capacidade:

```ts
const { count: occupiedCount } = await adminClient
  .from('tournament_entries')
  .select('id', { count: 'exact', head: true })
  .eq('tournament_id', tournamentId)
  .in('entry_status', ['confirmed', 'offered'])

const slots = availableSlots(occupiedCount ?? 0, tournament.max_players)
const entryStatus = slots > 0 ? 'confirmed' : 'waitlist'
```

Se `entryStatus === 'waitlist'`:
- `payment_status = 'free'` (não paga enquanto na fila), `discount_pct = 0`, `final_price_cents = 0`
- `computePaymentFields` não é chamado

### 4.2 `removeEntry` (modificar)

Ao fim, após delete bem-sucedido, chamar:
```ts
await expireAndPromote(adminClient, tournamentId, tournament.max_players)
```

A busca do torneio (já existente no início da função) deve incluir `max_players` no select.

### 4.3 `cancelEntryForNonPayment(entryId)` (nova action)

```ts
export async function cancelEntryForNonPayment(
  entryId: string,
): Promise<{ error?: string }>
```

1. Verificar usuário autenticado + role `admin` na org
2. Buscar entry: `id, tournament_id, player_id, payment_status, final_price_cents, created_at`
3. Validar `payment_status === 'pending'` — só faz sentido cancelar pendente
4. Aplicar reversal de desconto nas outras entries `pending` da semana (mesma lógica de `removeEntry`)
5. Deletar entry
6. Buscar `tournament.max_players`; chamar `expireAndPromote`
7. `revalidatePath('/admin/torneios/[id]')`

### 4.4 `confirmWaitlistOffer(tournamentId)` (nova action)

```ts
export async function confirmWaitlistOffer(
  tournamentId: string,
): Promise<{ error?: string }>
```

1. Verificar usuário autenticado
2. Buscar entry do usuário com `entry_status = 'offered'` nesse torneio
3. Se não existe → `{ error: 'Você não tem uma oferta de vaga ativa.' }`
4. Se `isOfferExpired(entry.offer_expires_at)`:
   - Chamar `expireAndPromote` (limpa a oferta e promove próximo)
   - Retornar `{ error: 'Sua oferta de vaga expirou. Você voltou para a lista de espera.' }`
5. Buscar `tournament.entry_price_cents` e `pix_key`
6. Determinar novo `payment_status`:
   - Torneio pago (`entry_price_cents > 0 && pix_key`) → `'pending'`; calcular `final_price_cents` com desconto
   - Torneio gratuito → `'free'`
7. `UPDATE entry SET entry_status = 'confirmed', offer_expires_at = null, payment_status = ..., final_price_cents = ...`
8. `revalidatePath('/t/[id]')`

### 4.5 `createTournament` (modificar)

Aceitar `max_players?: number | null` no input e gravar na tabela.

---

## 5. Admin UI — `/admin/torneios/[id]/page.tsx`

### Query de entries

Adicionar ao select: `entry_status`, `offer_expires_at`.  
Adicionar join com `profiles.phone` do jogador (já existe join com `full_name`; adicionar `phone` ao select).  
Adicionar `max_players` ao select do torneio.

### Cabeçalho da seção de inscrições

```
Inscritos  12 / 16 vagas      ← quando max_players definido
Inscritos  12 inscritos        ← quando max_players é null
```

### Três seções na lista

**① Confirmados** (`entry_status = 'confirmed'`)

Card existente. Adicionar quando `payment_status === 'pending'`:

- **Link WhatsApp** (se `player.phone` não nulo) — `<a>` tag no Server Component:
  ```
  📱 Cobrar via WhatsApp
  ```
  Mensagem: `"Olá {nome}! Sua inscrição no torneio {nome_torneio} aguarda pagamento de R$ {valor} via PIX para a chave {pix_key}. Envie o comprovante pelo app. Obrigado!"`

- **`CancelForNonPaymentButton`** — novo Client Component:
  - Estilo vermelho: `bg-red-700 hover:bg-red-600`
  - Confirmação inline: ao clicar mostra "Tem certeza? [Sim] [Não]" sem modal
  - Chama `cancelEntryForNonPayment(entryId)`
  - `router.refresh()` no sucesso

**② Ofertas pendentes** (`entry_status = 'offered'`)

Card compacto por jogador:
- Nome + badge amarelo "Vaga oferecida"
- "Expira em Xh Ym" (calculado no Server Component com `offer_expires_at`)
- Se já expirada: badge cinza "Expirada — será reprocessada na próxima ação"
- Link WhatsApp para notificar (se `player.phone`):
  Mensagem: `"Olá {nome}! Uma vaga abriu no torneio {nome_torneio}. Acesse {url} e confirme sua inscrição em até 48h."`

**③ Lista de espera** (`entry_status = 'waitlist'`)

Lista simples, ordenada por `created_at`:
- Posição (`#1`, `#2`…), nome do jogador, data de inscrição
- Sem ações — promoção é automática via `expireAndPromote`

### Novos componentes

- `CancelForNonPaymentButton.tsx` — único novo Client Component desta seção

---

## 6. Página pública `/t/[id]/page.tsx`

### Query de entries

Adicionar ao select do `tournament_entries` do usuário: `entry_status`, `offer_expires_at`.  
Adicionar `max_players` ao select do torneio.

### Contador de vagas (quando `max_players` definido e torneio aberto)

```
12 / 16 inscritos
```
Mostrado acima do CTA. Conta só `entry_status = 'confirmed'` (não expõe 'offered' ao público).

### Seção de inscritos (lista de avatares)

Filtrar apenas `entry_status = 'confirmed'` — waitlist e offered ficam invisíveis para outros jogadores.

### Bloco CTA — novos estados

| Situação | UI |
|---|---|
| Não inscrito + vagas disponíveis | Botão "Inscrever-se" (atual) |
| Não inscrito + torneio **lotado** | Botão "Entrar na lista de espera" (mesma action, vai para `waitlist`) |
| `entry_status = 'waitlist'` | "🕐 Você está na lista de espera — posição X" |
| `entry_status = 'offered'` + válida | "🎉 Vaga disponível! Confirme até [dia HH:mm]" + `ConfirmWaitlistButton` |
| `entry_status = 'offered'` + expirada | "⏰ Sua oferta de vaga expirou. Você voltou para a fila." |
| `entry_status = 'confirmed'` | Estados atuais (free/pending/paid) |

**Posição na fila** calculada no Server Component:
```ts
const { count: position } = await adminClient
  .from('tournament_entries')
  .select('id', { count: 'exact', head: true })
  .eq('tournament_id', id)
  .eq('entry_status', 'waitlist')
  .lte('created_at', userEntry.created_at)
```

### Novos componentes

- `ConfirmWaitlistButton.tsx` — Client Component, chama `confirmWaitlistOffer(tournamentId)`, `router.refresh()` no sucesso

---

## 7. CreateTournamentForm

Campo adicional após "Chave PIX":

```
Limite de vagas
[Input type=number, min=2, placeholder="Sem limite (deixe vazio)"]
```

- Vazio → `max_players = null`
- Validação client-side: inteiro ≥ 2
- Passado para `createTournament` como `max_players: number | null`

### Cancelamento pelo próprio jogador da fila

Jogador em `waitlist` ou `offered` pode cancelar via `removeEntry` existente (já disponível na página pública). Não há UI nova — o botão "Cancelar inscrição" existente cobre os três status. `expireAndPromote` é chamado em seguida normalmente.

---

## 8. Types — `types/index.ts`

```ts
// Tournament — adicionar após pix_key:
max_players: number | null

// TournamentEntry — adicionar após receipt_url:
entry_status: 'confirmed' | 'waitlist' | 'offered'
offer_expires_at: string | null
```

---

## 9. Arquivo de mapa de mudanças

| Arquivo | Ação |
|---|---|
| `supabase/migrations/20260701000100_tournament_waitlist.sql` | Criar — `max_players` + `entry_status` + `offer_expires_at` |
| `lib/torneios/waitlist.ts` | Criar — `availableSlots`, `isOfferExpired`, `buildWhatsAppUrl` |
| `lib/torneios/waitlist.test.ts` | Criar — testes TDD |
| `types/index.ts` | Modificar — `Tournament` + `TournamentEntry` |
| `features/torneios/actions.ts` | Modificar — `expireAndPromote` helper + 2 actions novas + 3 actions modificadas |
| `app/(admin)/admin/torneios/[id]/page.tsx` | Modificar — 3 seções + WhatsApp link + capacidade |
| `app/(admin)/admin/torneios/[id]/CancelForNonPaymentButton.tsx` | Criar |
| `app/(public)/t/[id]/page.tsx` | Modificar — estados waitlist/offered + contador + filtro |
| `app/(public)/t/[id]/ConfirmWaitlistButton.tsx` | Criar |
| `app/(admin)/admin/torneios/CreateTournamentForm.tsx` | Modificar — campo `max_players` |

---

## 10. Verificação (critérios de aceite)

1. `npm run test:run` — todos os testes passam, incluindo novos de `waitlist.ts`
2. `npm run build` — sem erros de tipo
3. Torneio sem `max_players`: comportamento idêntico ao atual
4. Torneio com `max_players = 2`, 2 inscritos: 3º vai para waitlist, vê posição na página pública
5. Admin remove 1 inscrito pendente → `expireAndPromote` promove o 1º da fila para `offered`
6. Jogador em `offered` acessa `/t/[id]` → vê botão "Confirmar vaga"
7. Após 48h: `confirmWaitlistOffer` detecta expiração, retorna erro, jogador volta para `waitlist`
8. Admin clica "Cobrar via WhatsApp" em entrada pendente com telefone → abre WhatsApp com mensagem pré-preenchida
9. Admin cancela por falta de pagamento → entry removida, reversal aplicado, próximo da fila promovido
