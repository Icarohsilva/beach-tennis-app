# Onboarding pós-cadastro com CEP — Design

**Data:** 2026-06-18
**Status:** Aprovado (aguardando revisão da spec escrita)

## Contexto

Hoje o fluxo de criação de academia (`app/(auth)/criar-academia`) é uma página única: nome da academia, seu nome, email, telefone, senha, mais uma seção colapsada "Personalização (opcional)" (descrição + cor da marca). Ao enviar, `createAcademy` cria a org + o usuário dono e redireciona direto para `/admin/dashboard`.

O endereço da academia (`state`, `city`, `neighborhood`, `address_line`, `whatsapp`, `sports`, `is_listed`) já existe na tabela `organizations` (migration `20260618000000_org_listing_fields.sql`) mas só é editável depois, em `VitrineForm` (`/admin/configuracoes`). Resultado: academias recém-criadas entram no painel sem endereço e **não aparecem** no diretório público `/arenas` até o dono descobrir a tela de configurações.

## Objetivo

Após o cadastro, **bloquear** o acesso ao painel até o dono preencher o endereço da academia. A tela coleta o **CEP**, busca o endereço numa API de CEP (ViaCEP) e **auto-preenche** UF/cidade/bairro/rua. O **número** do endereço é obrigatório; se não houver número, um checkbox "Sem número" remove a obrigatoriedade. Na mesma tela, abaixo do endereço, fica a seção **Personalização (opcional) já expandida** (descrição + cor da marca). Reaproveita os campos de vitrine adicionados no plano `/arenas`.

## Decisões tomadas (brainstorming)

- **Onboarding totalmente obrigatório:** bloqueia o painel até o endereço estar completo (CEP + número, ou "sem número").
- **Vitrine completa na tela:** endereço + esportes + WhatsApp + toggle "aparecer no diretório", e Personalização (descrição + cor) logo abaixo.
- **Abordagem A — página única rolável:** uma página `/onboarding` com a seção Endereço e, abaixo, Personalização já expandida; um único botão "Concluir". Sem wizard de múltiplos passos, sem modal.
- **API de CEP:** ViaCEP (`https://viacep.com.br/ws/{cep}/json/`) — grátis, CORS liberado, retorna `logradouro`, `bairro`, `localidade`, `uf`, e `erro: true` quando inválido.

## Escopo

### 1. Modelo de dados

Migration nova `supabase/migrations/20260619000000_org_onboarding_fields.sql`:

- `ALTER TABLE organizations ADD COLUMN cep text`
- `ADD COLUMN address_number text`
- `ADD COLUMN no_number boolean NOT NULL DEFAULT false`
- `ADD COLUMN onboarding_completed boolean NOT NULL DEFAULT false`
- **Backfill (ordem importa):** `UPDATE organizations SET onboarding_completed = true;` aplicado na própria migration, **depois** de adicionar a coluna com default `false`. Isso marca todas as orgs existentes (Academia Hudson Barros / org #1 e quaisquer orgs de teste) como já onboarded, para não serem barradas. Orgs criadas a partir daí nascem `false`.

`types/index.ts`: a interface `Organization` ganha `cep: string | null`, `address_number: string | null`, `no_number: boolean`, `onboarding_completed: boolean`.

### 2. Lookup de CEP

`lib/arenas/cep.ts` (com teste co-localizado `cep.test.ts`), funções puras:

- `formatCep(raw: string): string` — remove não-dígitos e aplica máscara `00000-000`.
- `isCompleteCep(raw: string): boolean` — true quando há exatamente 8 dígitos.
- `mapViaCep(payload): { state: string; city: string; neighborhood: string; addressLine: string }` — mapeia `uf → state`, `localidade → city`, `bairro → neighborhood`, `logradouro → addressLine`. Puro, testável sem rede.

O `fetch` ao ViaCEP fica **no componente client** (`OnboardingForm`), disparado quando `isCompleteCep` passa a ser true. Trata `{ erro: true }` (e falha de rede) exibindo "CEP não encontrado — preencha manualmente" e mantém os campos editáveis. Os campos auto-preenchidos permanecem editáveis sempre.

### 3. Rota `/onboarding`

- `app/onboarding/page.tsx` (Server Component, fora do grupo `(admin)` para evitar loop de redirect com o gate do layout):
  - Chama `requireOwner()` (redireciona não-autenticado → `/login`; professor → `/admin/dashboard`).
  - Lê a org via `getCurrentOrg()`.
  - Se `onboarding_completed === true`, `redirect('/admin/dashboard')` (impede reabrir a tela depois de concluída).
  - Passa os valores atuais da org (cep/endereço/sports/whatsapp/description/brand_color/is_listed) como props iniciais ao form.
- `app/onboarding/OnboardingForm.tsx` (Client Component) — página única rolável dentro de um `Card`, no tema dark (gradiente de marca no topo):
  - **Seção Endereço:**
    - CEP (input com `formatCep` ao digitar; ao completar, busca ViaCEP e preenche os campos abaixo).
    - UF, Cidade, Bairro, Rua/logradouro (auto-preenchidos, editáveis).
    - Número (obrigatório por padrão).
    - Checkbox "Sem número" — quando marcado, oculta/desabilita o campo Número e remove a obrigatoriedade.
    - Esportes (chips, reaproveitando `SPORTS` de `lib/arenas/sports.ts`).
    - WhatsApp.
    - Toggle "Aparecer no diretório público de arenas" (`is_listed`).
  - **Seção Personalização (opcional), já expandida:** Descrição (textarea) + Cor da marca (input color).
  - Botão "Concluir e ir para o painel" → chama `completeOnboarding`; em sucesso, `router.push('/admin/dashboard')` + `router.refresh()`.
  - Exibe erros de validação retornados pela action.

### 4. Gate de bloqueio

- `app/(admin)/layout.tsx`: incluir `onboarding_completed` no `select` da org (junto de `owner_id, name`). Após confirmar `role === 'admin'`, se `!org.onboarding_completed`, `redirect('/onboarding')`.
  - Professores nunca são barrados: quando um professor é criado (`createProfessor`), o dono já concluiu o onboarding, então `onboarding_completed` da org já é `true`.
  - O grupo `(dashboard)` (alunos) **não** recebe gate.
- `app/(auth)/criar-academia/page.tsx`:
  - Após o auto-login bem-sucedido, `router.push('/onboarding')` em vez de `/admin/dashboard`.
  - Remover a seção `<details>` "Personalização (opcional)" do form e os campos `description`/`brandColor` do estado `form` (passam a ser coletados no onboarding). `createAcademy` continua aceitando `description`/`brandColor` como opcionais na assinatura (não quebra), mas o form de cadastro deixa de enviá-los.

### 5. Action de salvar

`features/organizations/actions.ts`: nova `completeOnboarding(input)`:

```ts
export interface CompleteOnboardingInput {
  cep: string
  state: string
  city: string
  neighborhood: string
  address_line: string
  address_number: string
  no_number: boolean
  sports: string[]
  whatsapp: string
  is_listed: boolean
  description: string
  brand_color: string
}
```

- Owner-only: usa `getStaffContext()`; se `!ctx` → `{ error: 'Não autenticado.' }`; se `!ctx.isOwner` → `{ error: 'Apenas o dono pode concluir o cadastro da academia.' }`. Deriva `orgId = ctx.organizationId` no servidor (nunca confia em id vindo do client).
- **Validações:** CEP preenchido; cidade preenchida; `address_number` preenchido **ou** `no_number === true`. Erro claro em português para cada caso.
- Grava na org (`createAdminClient().update(...).eq('id', orgId)`): `cep`, `state`, `city`, `neighborhood`, `address_line`, `address_number`, `no_number`, `sports` (via `normalizeSports`), `whatsapp`, `is_listed`, `description`, `brand_color`, e `onboarding_completed = true`.
- `revalidatePath('/arenas')` e `revalidatePath('/admin/configuracoes')` (import dinâmico de `revalidatePath`, seguindo o padrão de `updateOrgListing`).

### 6. Edição posterior + exibição

- `VitrineForm` (`/admin/configuracoes/VitrineForm.tsx`): adicionar campos CEP, Número e checkbox "Sem número", com o mesmo auto-preenchimento via ViaCEP (reutilizando `lib/arenas/cep.ts`). `updateOrgListing` (`features/financeiro/actions.ts`) passa a aceitar e gravar `cep`, `address_number`, `no_number`. A page `configuracoes/page.tsx` passa esses campos no `listing` inicial.
- **Exibição do endereço:** helper `formatAddress(org)` em `lib/arenas/` (com teste): compõe `address_line` + número → `"Rua X, 123"`, ou `"Rua X, s/n"` quando `no_number`, ou só `address_line` quando não há número nem flag. Usado em `app/arenas/[slug]/page.tsx` e no card do diretório (`app/arenas/page.tsx`) — substituindo a exibição atual de `address_line` cru.

## Arquivos

- Criar: `supabase/migrations/20260619000000_org_onboarding_fields.sql`
- Criar: `lib/arenas/cep.ts` + `lib/arenas/cep.test.ts`
- Criar: `lib/arenas/formatAddress.ts` + `lib/arenas/formatAddress.test.ts` (ou adicionar a um helper de arenas existente)
- Criar: `app/onboarding/page.tsx`, `app/onboarding/OnboardingForm.tsx`
- Modificar: `types/index.ts` (campos novos em `Organization`)
- Modificar: `features/organizations/actions.ts` (`completeOnboarding`)
- Modificar: `features/financeiro/actions.ts` (`updateOrgListing` aceita cep/address_number/no_number)
- Modificar: `app/(admin)/layout.tsx` (gate)
- Modificar: `app/(auth)/criar-academia/page.tsx` (redirect + remover Personalização)
- Modificar: `app/(admin)/admin/configuracoes/page.tsx` + `VitrineForm.tsx` (campos CEP/número)
- Modificar: `app/arenas/[slug]/page.tsx` + `app/arenas/page.tsx` (usar `formatAddress`)

## Verificação

1. `npm run test:run` — novos testes de `cep.ts` e `formatAddress` passam; suíte beach-tennis-app verde (as falhas em `octogent/` são de outro projeto e não contam).
2. `npm run build` — sem erro de tipo após os campos novos em `Organization`.
3. Manual (ponta a ponta):
   - Criar academia de teste → cai em `/onboarding` (não no dashboard).
   - Digitar CEP válido → UF/cidade/bairro/rua auto-preenchem.
   - Tentar "Concluir" sem número e sem marcar "sem número" → bloqueado com mensagem.
   - Marcar "Sem número" → conclui; redireciona ao dashboard.
   - A arena aparece em `/arenas` com endereço formatado correto (`Rua X, 123` ou `Rua X, s/n`).
   - Logar como Academia Hudson Barros (org existente, `onboarding_completed = true` via backfill) → vai direto ao dashboard, **não** é barrada.
4. Migration aplicada em produção pelo usuário (padrão do projeto: SQL Editor / `supabase db push`).

## Fora de escopo

- Geocoding / mapa / latitude-longitude.
- Validação de CEP contra base oficial dos Correios (ViaCEP é suficiente).
- Edição do endereço por professores (continua owner-only).
- Logo upload / temas avançados de personalização (Plano 4).
