# Torneios Públicos — Página de Compartilhamento, Premiação e Inscrição Externa

## Contexto

O motor de torneios (plano anterior) entregou o ciclo completo: criar torneio, gerar chave, lançar placar, confirmar resultado, classificação. O que falta é a camada de **visibilidade pública e fechamento**:

1. **Página pública `/t/[id]`** — link compartilhável no WhatsApp/Instagram, sem exigir login do visitante.
2. **Imagem de capa** — o admin faz upload de uma foto que aparece como hero na página pública e como thumbnail no preview do WhatsApp/Instagram (OG tags).
3. **Premiação** — ao encerrar o torneio, o sistema preenche automaticamente 1º/2º/3º a partir da classificação; o admin pode corrigir.
4. **Inscrição avulsa** — visitante sem conta (ou sem matrícula) pode se inscrever pelo link compartilhado; se não tem conta é redirecionado para `/login?next=/t/[id]`.
5. **Remoção do label "Americano"** — em nenhuma interface voltada ao usuário/visitante aparece o nome do formato; o nome que o admin definiu ("Super 8", "Super 6", etc.) é o único rótulo público.

---

## Decisões de Design

| # | Decisão | Escolha |
|---|---------|---------|
| 1 | Premiação | Automática do top 3 da classificação ao encerrar; admin pode corrigir |
| 2 | URL pública | `/t/[id]` (UUID do torneio) |
| 3 | Inscrição externa | Avulso — não precisa de matrícula, só de conta (login) |
| 4 | Imagem de capa | Upload no formulário de criação + troca no admin detalhe |
| 5 | Arquitetura | Novo route group `app/(public)/t/[id]/` — sem auth middleware |
| 6 | Label de formato | Removido de toda UI voltada a usuários; só o nome do torneio aparece |

---

## Banco de Dados

### Migration 1 — `20260628000100_tournament_cover_winners.sql`

Adiciona à tabela `tournaments`:

```sql
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS cover_image_url text;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS winner1_id uuid references profiles(id);
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS winner2_id uuid references profiles(id);
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS winner3_id uuid references profiles(id);
-- Para formato dupla_fixa, guarda o parceiro de cada posição do pódio.
-- Para americano (rotativo), partner é null; o ranking é individual.
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS winner1_partner_id uuid references profiles(id);
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS winner2_partner_id uuid references profiles(id);
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS winner3_partner_id uuid references profiles(id);
```

`winner1_id` = 1º lugar, `winner2_id` = 2º lugar, `winner3_id` = 3º lugar.  
Para formatos individuais/revezando, `winnerN_partner_id` fica null.

### Migration 2 — `20260628000200_tournament_images_bucket.sql`

Cria bucket público para as capas:

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tournament-images', 'tournament-images', true, 5242880,
        ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Qualquer usuário autenticado pode fazer upload (admin); leitura é pública.
CREATE POLICY "tournament-images upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'tournament-images');

CREATE POLICY "tournament-images public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'tournament-images');
```

### Migration 3 — `20260628000300_tournaments_public_read.sql`

Adiciona políticas de leitura pública (para futura flexibilidade; a página atual usa `createAdminClient()` que já bypassa RLS):

```sql
-- Torneios abertos/em andamento/encerrados são visíveis a qualquer um (anon ou auth).
CREATE POLICY "tournaments_public_read" ON tournaments
  FOR SELECT TO anon, authenticated
  USING (status IN ('open', 'in_progress', 'finished'));

-- Inscritos de torneios públicos também são visíveis.
CREATE POLICY "tournament_entries_public_read" ON tournament_entries
  FOR SELECT TO anon, authenticated
  USING (
    tournament_id IN (
      SELECT id FROM tournaments WHERE status IN ('open', 'in_progress', 'finished')
    )
  );
```

> **Nota:** As migrations são aplicadas manualmente pelo usuário via SQL Editor do Supabase; não rodar `supabase db push`.

---

## Tipos TypeScript (`types/index.ts`)

Adicionar campos ao tipo `Tournament`:

```ts
export interface Tournament {
  // campos existentes preservados …
  cover_image_url: string | null
  winner1_id: string | null
  winner2_id: string | null
  winner3_id: string | null
  winner1_partner_id: string | null
  winner2_partner_id: string | null
  winner3_partner_id: string | null
  // joins opcionais para a página pública
  winner1?: Pick<Profile, 'id' | 'full_name'> | null
  winner2?: Pick<Profile, 'id' | 'full_name'> | null
  winner3?: Pick<Profile, 'id' | 'full_name'> | null
  winner1_partner?: Pick<Profile, 'id' | 'full_name'> | null
  winner2_partner?: Pick<Profile, 'id' | 'full_name'> | null
  winner3_partner?: Pick<Profile, 'id' | 'full_name'> | null
}
```

---

## Middleware

Adicionar `/t/` à lista de rotas públicas em `middleware.ts`:

```ts
pathname.startsWith('/t/') ||   // ← nova linha
```

---

## Route Group Público — `app/(public)/`

### `app/(public)/layout.tsx`

Layout mínimo sem guards de auth. Inclui apenas os metadados base e o tema (sem BottomNav, sem Sidebar):

```tsx
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
```

### `app/(public)/t/[id]/page.tsx`

Server Component. Usa `createAdminClient()` para ler torneio + inscritos + perfis dos vencedores (bypass de RLS — a página é pública por design, o admin client é seguro em Server Components).

Gera OG meta tags dinâmicos (`generateMetadata`):
- `title` = nome do torneio
- `description` = data + organização
- `openGraph.images` = `cover_image_url` (fallback: imagem padrão ArenaHub)
- `twitter:card` = `summary_large_image`

Conteúdo renderizado (conforme layout aprovado):
1. **Cover image** (hero 160px, gradient de fallback se sem imagem) + botão Compartilhar overlay
2. **Badges**: status, esporte, nível, categoria — **sem badge de formato**
3. **Nome do torneio** (h1, destaque)
4. **Data + local** (subtítulo)
5. **CTA de inscrição**: se `status = 'open'`
   - Não autenticado → botão redireciona para `/login?next=/t/[id]`
   - Autenticado, não inscrito → `<RegisterExternalButton tournamentId={id} />`
   - Já inscrito → badge "Você está inscrito ✓"
6. **Lista de inscritos** (chips com nome abreviado, ex.: "Icaro S.")
7. **Resultado final** (pódio 🥇🥈🥉): visível apenas quando `status = 'finished'`
8. **Powered by ArenaHub** (rodapé)

### `app/(public)/t/[id]/RegisterExternalButton.tsx`

Client Component. Chama `registerExternal(tournamentId)`. Mostra estado de loading. Em caso de sucesso, revalida a página (`router.refresh()`). Em caso de erro (torneio cheio, já inscrito), exibe toast/mensagem inline.

---

## Actions

### `lib/torneios/actions.ts` — novas funções

#### `closeTournament(tournamentId: string)`

```ts
export async function closeTournament(tournamentId: string) {
  // 1. Busca torneio + entradas + partidas (via createAdminClient)
  // 2. Chama FORMATS[format].computeStandings(entries, matches, scoring)
  // 3. Extrai top 3 da classificação
  // 4. UPDATE tournaments SET
  //      status = 'finished',
  //      winner1_id = standings[0].playerId,
  //      winner2_id = standings[1]?.playerId,
  //      winner3_id = standings[2]?.playerId,
  //      winner1_partner_id = null,  -- americano é individual (rotativo); null para todos
  //      winner2_partner_id = null,  -- dupla_fixa: implementação futura
  //      winner3_partner_id = null
  //    WHERE id = tournamentId AND organization_id = orgId
  // 5. Revalida /admin/torneios/[id] e /t/[id]
}
```

Requer papel admin (verificado via `getStaffContext()`).

#### `updateWinners(tournamentId, winners)`

Permite ao admin corrigir manualmente o pódio após `closeTournament`:

```ts
type WinnersInput = {
  winner1_id: string | null
  winner2_id: string | null
  winner3_id: string | null
  winner1_partner_id?: string | null
  winner2_partner_id?: string | null
  winner3_partner_id?: string | null
}
export async function updateWinners(tournamentId: string, winners: WinnersInput)
```

#### `updateTournamentCover(tournamentId: string, coverImageUrl: string | null)`

Atualiza `tournaments.cover_image_url`. Usado pelo botão "Trocar" no admin detalhe.

#### `registerExternal(tournamentId: string)`

Inscreve o usuário logado num torneio **sem** checar membership:

```ts
export async function registerExternal(tournamentId: string): Promise<{ error?: string }> {
  const supabase = createClient()           // client normal (para ler sessão)
  const admin = createAdminClient()         // para escrita sem RLS
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  // Busca tournament via admin (precisa de organization_id)
  const { data: tournament } = await admin
    .from('tournaments')
    .select('id, organization_id, status, participant_type')
    .eq('id', tournamentId)
    .single()
  if (!tournament) return { error: 'Torneio não encontrado' }
  if (tournament.status !== 'open') return { error: 'Inscrições encerradas' }

  // Insere via admin (sem RLS membership check)
  const { error } = await admin.from('tournament_entries').insert({
    tournament_id: tournamentId,
    organization_id: tournament.organization_id,
    player_id: user.id,
    partner_id: null,   // avulso não escolhe parceiro fixo no momento da inscrição
  })
  if (error?.code === '23505') return { error: 'Você já está inscrito' }
  if (error) return { error: 'Erro ao inscrever' }

  revalidatePath(`/t/${tournamentId}`)
  return {}
}
```

---

## Admin — Imagem de Capa

### `CreateTournamentForm.tsx` (modificar)

Adicionar campo de upload antes do botão "Criar Torneio":

- Input `<input type="file" accept="image/jpeg,image/png,image/webp">` estilizado com borda dashed laranja
- No `handleSubmit`: se arquivo selecionado, faz upload para `tournament-images/{uuid}` via `supabase.storage.from('tournament-images').upload(path, file)`; captura a URL pública; passa `cover_image_url` para `createTournament()`
- `createTournament()` action: aceitar `cover_image_url?: string | null` como novo parâmetro

### `app/(admin)/admin/torneios/[id]/page.tsx` (modificar)

Adicionar dois novos cards no admin detalhe:

**Card "Link público"** (novo):
- Preview da imagem de capa atual (ou placeholder gradient)
- Botão "Trocar" → abre `<input type="file">` oculto → upload → chama `updateTournamentCover()`
- Campo com URL copiável: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://arenahub.website'}/t/[id]`
- Botão laranja "Copiar" → `navigator.clipboard.writeText(...)`

**Card "Resultado final"** (novo):
- Desabilitado (opacidade 50%) enquanto `status !== 'finished'`
- Ao encerrar: mostra pódio preenchido automaticamente com chips editáveis (select de participantes)
- Botão "Salvar resultado" → chama `updateWinners()`

**Botão "Encerrar torneio"** (nas Ações):
- Ao clicar: confirm dialog → chama `closeTournament()` → revalida página

---

## Remoção do Label "Americano"

Arquivos a auditar e corrigir:

| Arquivo | O que remover/corrigir |
|---------|----------------------|
| `app/(admin)/admin/torneios/CreateTournamentForm.tsx` | `FORMAT_OPTIONS` label pode permanecer no formulário admin (é o admin quem vê) mas remover o badge do formato em qualquer preview voltado ao aluno |
| `app/(dashboard)/torneios/[id]/page.tsx` | Remover qualquer badge que mostre "Americano" ou "Super N" |
| `app/(public)/t/[id]/page.tsx` | **Nunca** incluir badge de formato — só nome, esporte, nível, categoria, status |
| `features/torneios/StandingsTable.tsx` | Verificar se exibe label de formato |

Regra geral: o campo `format` existe no banco e no código para o motor; nunca é exposto em UI voltada a alunos ou visitantes.

---

## Arquivos a Criar / Modificar

### Criar (novos)
- `supabase/migrations/20260628000100_tournament_cover_winners.sql`
- `supabase/migrations/20260628000200_tournament_images_bucket.sql`
- `supabase/migrations/20260628000300_tournaments_public_read.sql`
- `app/(public)/layout.tsx`
- `app/(public)/t/[id]/page.tsx`
- `app/(public)/t/[id]/RegisterExternalButton.tsx`

### Modificar (existentes)
- `middleware.ts` — adicionar `/t/` às rotas públicas
- `types/index.ts` — novos campos em `Tournament`
- `lib/torneios/actions.ts` — `closeTournament`, `updateWinners`, `updateTournamentCover`, `registerExternal`, atualizar `createTournament`
- `app/(admin)/admin/torneios/CreateTournamentForm.tsx` — campo de upload de imagem
- `app/(admin)/admin/torneios/[id]/page.tsx` — cards Link público + Resultado final + botão Encerrar
- `app/(dashboard)/torneios/[id]/page.tsx` — remover badge de formato

---

## Fluxo de Dados — Inscrição Avulsa

```
Visitante abre /t/abc123
  → Server Component lê tournament (admin client)
  → Se status = 'open': exibe botão Inscrever-se
  → Clica Inscrever-se
    → Se não autenticado: redirect /login?next=/t/abc123
    → Login/cadastro feito → redirect de volta /t/abc123
    → RegisterExternalButton.onClick → Server Action registerExternal('abc123')
      → auth.getUser() → tem uid
      → tournament.organization_id extraído (admin client)
      → INSERT tournament_entries (admin client, sem RLS)
      → revalidatePath('/t/abc123')
    → Página atualiza → badge "Você está inscrito ✓"
```

---

## Fluxo — Encerrar Torneio + Premiação

```
Admin clica "Encerrar torneio"
  → confirm dialog
  → closeTournament(id)
    → busca entries + matches confirmados
    → FORMATS[format].computeStandings(entries, matches, scoring)
    → top3 = standings.slice(0, 3)
    → UPDATE tournaments SET status='finished', winner1_id=..., winner2_id=..., winner3_id=...
    → revalidatePath('/admin/torneios/[id]'), revalidatePath('/t/[id]')
  → Admin vê "Resultado final" preenchido
  → Pode editar → updateWinners()
  → Página pública /t/[id] exibe pódio automaticamente
```

---

## Testes

- `lib/torneios/actions.ts` → `closeTournament`: coberto pelos testes existentes de standings (já testados em `computeStandings`). A action em si é integração (usa Supabase); não precisa de teste unitário adicional — o motor puro já está coberto.
- `registerExternal`: lógica de guarda (status !== 'open', duplicate key) testável em integração ou via mock do admin client.
- **Smoke test manual**:
  1. Criar torneio → copiar link `/t/[id]` → abrir em aba anônima → verificar página pública sem login
  2. Clicar "Inscrever-se" sem login → confirmar redirect para login → fazer cadastro → confirmar retorno ao torneio
  3. Inscrever-se avulso → confirmar badge "Você está inscrito"
  4. Encerrar torneio → confirmar pódio na página pública
  5. Adicionar imagem de capa → confirmar exibição na página pública e preview OG

---

## Fora de Escopo

- Notificações push quando o torneio encerra
- Paginação de inscritos (lista completa é suficiente para o tamanho atual)
- Torneio por convite (link privado com código) — pode ser plano futuro
- Editar inscrição avulsa (troca de parceiro) — apenas remoção via admin por ora
