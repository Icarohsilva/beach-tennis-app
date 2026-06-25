# Personalização visual por academia (white-label co-branded) — Design

**Data:** 2026-06-25
**Status:** Aprovado (design) — aguardando review da spec antes do plano de implementação

## Contexto

O ArenaHub é um SaaS multi-tenant: várias academias/quadras usam o mesmo app, isoladas por `organization_id`. Hoje a marca é **100% ArenaHub** (logo hardcoded, laranja `#f97316` em todos os tokens `brand-*` do Tailwind). Para vender como produto white-label, cada academia precisa aplicar **logo e cor próprias** nas suas telas, mantendo um selo discreto "Powered by ArenaHub".

As colunas `organizations.logo_url` e `organizations.brand_color` **já existem** no schema (criadas na migration `20260616000000_organizations.sql`), mas nenhuma é usada pelo app ainda.

Este é o item **branding** da sequência de produtização SaaS. O **painel super-admin** é um spec separado e posterior (decisão do usuário: branding primeiro).

## Decisões tomadas (brainstorming)

1. **Superfícies:** a marca da academia aparece nas **três** — app do aluno, painel admin e página pública `/arenas/[slug]`.
2. **Intensidade da cor:** **accent-only**. A cor da academia substitui o laranja em botões, links, header (gradiente) e estados ativos. Fundo escuro (`surface`) e cards **não mudam**. Funciona com qualquer cor, baixo risco.
3. **Co-branding:** **co-branded** — logo da academia é o principal, mas um selo discreto **"Powered by ArenaHub"** aparece sempre (rodapés). Mantém a exposição da plataforma. (White-label total e add-on premium ficam fora de escopo.)
4. **Seleção de cor:** **paleta curada** de ~8 cores pré-aprovadas (contraste garantido no tema escuro e com texto branco). Não há hex livre.
5. **Logo:** **upload de arquivo** para o Supabase Storage (não URL colada).

## Arquitetura

### 1. Modelo de dados

Sem novas colunas em `organizations` (`logo_url`, `brand_color` já existem).

- **`brand_color`**: guarda um hex pertencente a uma **allowlist** definida em código (ex.: `#f97316` laranja [default/ArenaHub], `#7c3aed`, `#2563eb`, `#059669`, `#dc2626`, `#db2777`, `#0891b2`, `#ca8a04`). Validado **no servidor** contra a allowlist — nunca um valor arbitrário. `null`/ausente ⇒ usa o default laranja.
- **`logo_url`**: URL pública de um arquivo no Supabase Storage. `null` ⇒ fallback para o logo ArenaHub.
- **Migration nova (única de banco):** cria o bucket de Storage `org-logos` (público para leitura) + policy de **upload/update/delete restrita ao dono** da org (`organizations.owner_id = auth.uid()`), com `organization_id` no path do objeto (ex.: `org-logos/{organization_id}/logo.png`).

### 2. Aplicação da cor (accent via variáveis CSS)

**Problema:** os tokens `brand-*` no `tailwind.config.ts` são hex estáticos, então `bg-brand-500` compila para `#f97316` literal — não dá pra trocar por academia em runtime.

**Solução:** converter a escala `brand` para **variáveis CSS com triplas RGB** (preserva os modificadores de opacidade do Tailwind, ex. `bg-brand-500/50`):

- `tailwind.config.ts`: `brand: { 500: 'rgb(var(--brand-500) / <alpha-value>)', ... }` para os 10 tons (50–900).
- `app/globals.css` `:root`: define os defaults laranja como triplas RGB (`--brand-500: 249 115 22;` etc.) — garante que telas sem academia ativa (auth, landing, fallback) continuem laranja.
- Helper puro **`lib/branding/theme.ts`**: `accentVars(brandColor: string)` recebe o hex da academia e devolve um objeto de CSS custom properties (as 10 triplas `--brand-50..900`) derivadas dessa cor. Como a paleta é curada, cada cor da allowlist pode ter sua escala pré-computada (mapa cor→escala) em vez de derivação algorítmica — mais simples e previsível. Testável (TDD).
- Cada **layout** injeta `style={accentVars(org.brand_color)}` num wrapper que envolve o conteúdo:
  - `app/(admin)/layout.tsx` — academia ativa via `getStaffContext()`.
  - `app/(dashboard)/layout.tsx` — academia ativa do aluno.
  - `app/arenas/[slug]/page.tsx` — academia resolvida pelo slug.
- Resultado: tudo que hoje é `brand-*` passa a refletir a cor da academia, **sem editar componente por componente**. Fundo/cards permanecem.

### 3. Logo

- **`components/ui/Logo.tsx`** ganha props opcionais `logoUrl?: string | null` e `orgName?: string`. Se `logoUrl` existe, renderiza `<Image>` com a logo da academia (alt = nome da org); senão, mantém o fallback atual (símbolo + wordmark "Arena**Hub**"). A wordmark "ArenaHub" só aparece no fallback.
- Call sites que recebem override (lêem a academia ativa e passam `logoUrl`): sidebar do admin (`app/(admin)/layout.tsx`), top bar do aluno (`app/(dashboard)/layout.tsx`/perfil), página pública (`app/arenas/[slug]/page.tsx`).
- Telas **sem** academia (login/cadastro em `app/(auth)/layout.tsx`, landing) continuam com o logo ArenaHub puro (sem override).

### 4. Selo "Powered by ArenaHub"

- Novo componente **`components/ui/PoweredBy.tsx`**: texto pequeno "Powered by **ArenaHub**" + símbolo da arena, link para `https://arenahub.website`, estilo discreto (cinza). Sempre renderizado, independente do branding da academia.
- Colocado nos rodapés: app do aluno, painel admin e página pública `/arenas/[slug]`.

### 5. Configuração (aba "Personalização")

- Em `app/(admin)/admin/configuracoes/`, nova seção/aba **owner-only** (a página já chama `requireOwner()`).
- Componente client **`BrandingForm.tsx`**:
  - **Upload de logo**: dropzone/input file (PNG/SVG, limite ~512KB, validação de tipo/tamanho no cliente e no servidor). Mostra a logo atual.
  - **Seletor de cor**: 8 swatches da allowlist; o selecionado fica destacado.
  - **Preview ao vivo**: um header de exemplo que aplica `accentVars(corSelecionada)` + a logo, atualizando na hora (client-side), antes de salvar.
- Server action **`updateBranding`** em novo arquivo `features/branding/actions.ts`:
  - `requireOwner()`; valida `brandColor ∈ allowlist`; se veio arquivo, valida tipo/tamanho e faz upload no bucket `org-logos` no path `{organization_id}/...` **via service role** (`createAdminClient`), já que a action está protegida por `requireOwner()`; grava `logo_url`/`brand_color` em `organizations`. A policy owner-only do bucket (abaixo) é defesa em profundidade contra acesso direto do cliente.
  - `revalidatePath` nas rotas afetadas (layouts admin/dashboard e a página pública da arena).

## Componentes e responsabilidades (unidades isoladas)

| Unidade | Responsabilidade | Depende de |
|---|---|---|
| `lib/branding/palette.ts` | Allowlist de cores + `isAllowedBrandColor()` | — (puro) |
| `lib/branding/theme.ts` | `accentVars(hex)` → CSS vars (mapa cor→escala) | palette |
| migration `*_org_logos_bucket.sql` | bucket `org-logos` + policy owner | organizations |
| `tailwind.config.ts` + `globals.css` | escala `brand` via CSS vars + defaults `:root` | — |
| `components/ui/Logo.tsx` | logo da academia com fallback ArenaHub | — |
| `components/ui/PoweredBy.tsx` | selo co-branding | — |
| `features/branding/actions.ts` (`updateBranding`) + `BrandingForm.tsx` | configurar logo/cor (owner-only) | palette, Storage |
| layouts (admin/dashboard/arena) | injetar `accentVars` + logo override | theme, Logo |

## Fluxo de dados

1. Dono abre Configurações → Personalização, escolhe cor (swatch) e envia logo → preview ao vivo.
2. Salvar → `updateBranding` valida, sobe logo no Storage, grava `brand_color`/`logo_url`, revalida.
3. Em qualquer request, o layout da academia ativa lê `brand_color`/`logo_url` e injeta `accentVars` + logo. Tailwind `brand-*` resolve para a cor da academia.
4. Página pública faz o mesmo resolvendo a org pelo slug.

## Erros e bordas

- **Cor fora da allowlist** → action rejeita com erro amigável; não grava.
- **Arquivo inválido** (tipo/tamanho) → rejeita no cliente e no servidor.
- **Sem `brand_color`** → defaults laranja do `:root` (nada quebra).
- **Sem `logo_url`** → fallback logo ArenaHub.
- **Hudson (org #1)** sem branding definido ⇒ continua laranja + logo ArenaHub, idêntica a hoje.

## Testes

- **Unit (TDD):** `isAllowedBrandColor()` (aceita allowlist, rejeita arbitrário/vazio); `accentVars()` (cor conhecida → escala esperada; cor inválida → cai no default laranja).
- **Build:** `npm run build` sem erros após a refatoração dos tokens Tailwind.
- **Smoke manual em academia de teste:** definir cor + logo e confirmar que app do aluno, painel admin e `/arenas/[slug]` mudam; confirmar que a Hudson continua idêntica (laranja + logo ArenaHub); confirmar selo "Powered by ArenaHub" visível.

## Fora de escopo (follow-ups)

- Painel super-admin (spec separado, próximo).
- Tema completo / reskin de superfícies (decisão B descartada).
- Hex livre de cor.
- Remover o "Powered by ArenaHub" como add-on premium.
- Branding em e-mails transacionais e splash do PWA.
