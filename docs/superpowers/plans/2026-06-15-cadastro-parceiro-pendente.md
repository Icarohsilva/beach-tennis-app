# Autodeclaração de Parceiro no Cadastro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o aluno declare Gympass(Wellhub)/TotalPass + ID no cadastro, ficando pendente até o admin confirmar e definir a meta de check-ins; corrigir o telefone que não era salvo.

**Architecture:** O `signUp` envia os dados extras no metadata; o trigger `handle_new_user` grava `phone`, `pending_partner` e o ID do parceiro no perfil sem mudar `payment_type`. O admin vê a pendência (badge na lista + banner no perfil) e confirma via `setStudentType` (que passa a limpar `pending_partner`) ou recusa via `clearPendingPartner`.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (Postgres trigger + RLS), Vitest.

**Spec:** [docs/superpowers/specs/2026-06-15-cadastro-parceiro-pendente-design.md](../specs/2026-06-15-cadastro-parceiro-pendente-design.md)

---

## File Structure

**Create:**
- `supabase/migrations/20260615010000_pending_partner.sql` — coluna `pending_partner` + atualização do trigger `handle_new_user`.

**Modify:**
- `types/index.ts` — `pending_partner` em `Profile`.
- `app/(auth)/cadastro/page.tsx` — seletor de parceiro + ID + telefone no metadata.
- `features/checkin/actions.ts` — `setStudentType` limpa `pending_partner`; nova `clearPendingPartner`.
- `app/(admin)/admin/alunos/[id]/page.tsx` — passar `pendingPartner` ao client.
- `app/(admin)/admin/alunos/[id]/StudentProfileClient.tsx` — banner Confirmar/Recusar.
- `app/(admin)/admin/alunos/page.tsx` — badge "Parceiro pendente".

---

## Task 1: Migration — coluna `pending_partner` + trigger

**Files:**
- Create: `supabase/migrations/20260615010000_pending_partner.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Autodeclaração de parceiro (Gympass/TotalPass) no cadastro, pendente de confirmação.

alter table profiles
  add column if not exists pending_partner checkin_partner;

-- Trigger passa a gravar phone, pending_partner e o ID do parceiro declarado.
-- payment_type permanece o default da tabela até o admin confirmar.
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  v_partner text := new.raw_user_meta_data->>'pending_partner';
  v_partner_id text := new.raw_user_meta_data->>'partner_id';
begin
  insert into public.profiles (id, full_name, avatar_url, phone, pending_partner, wellhub_id, totalpass_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'phone',
    case when v_partner in ('wellhub','totalpass') then v_partner::checkin_partner else null end,
    case when v_partner = 'wellhub' then v_partner_id else null end,
    case when v_partner = 'totalpass' then v_partner_id else null end
  );
  return new;
end;
$$;
```

- [ ] **Step 2: Verify consistency (do NOT apply)**

Do not run `supabase db push` (mutates the real DB; handled separately by the owner). Read `supabase/migrations/003_profile_trigger.sql` and `20260615000000_checkins.sql` to confirm: the enum `checkin_partner` exists (from the checkins migration), the original `handle_new_user` shape matches, and `profiles` has `phone`, `wellhub_id`, `totalpass_id`. Report DONE_WITH_CONCERNS if anything is off.

> Dependency note: this migration requires `20260615000000_checkins.sql` (which creates the `checkin_partner` enum) to run first. Both are unapplied; `supabase db push` applies them in filename order, so `20260615010000` runs after `20260615000000`. Correct.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260615010000_pending_partner.sql
git commit -m "feat(cadastro): coluna pending_partner e trigger lendo parceiro/telefone"
```

---

## Task 2: Tipo `pending_partner` no Profile

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 1: Add the field to `Profile`**

Em `types/index.ts`, no `interface Profile`, logo após a linha `monthly_checkin_target: number` (adicionada antes), inserir:

```ts
  pending_partner: CheckinPartner | null
```

(`CheckinPartner` já é exportado neste arquivo.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat(cadastro): pending_partner no tipo Profile"
```

---

## Task 3: Form de cadastro — parceiro, ID e telefone

**Files:**
- Modify: `app/(auth)/cadastro/page.tsx`

- [ ] **Step 1: Add partner state**

Em `app/(auth)/cadastro/page.tsx`, após `const [form, setForm] = useState(...)`, adicionar:

```ts
  const [partner, setPartner] = useState<'none' | 'wellhub' | 'totalpass'>('none')
  const [partnerId, setPartnerId] = useState('')
```

- [ ] **Step 2: Build metadata and validate in `handleCadastro`**

Substituir o início de `handleCadastro` (o trecho que monta e chama `signUp`) para validar o ID e montar o metadata. Trocar:

```ts
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { data, error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: { data: { full_name: form.full_name } },
    })
```

por:

```ts
    if (partner !== 'none' && !partnerId.trim()) {
      setError('Informe o ID do seu Gympass/TotalPass.')
      return
    }
    setLoading(true)
    setError('')
    const supabase = createClient()
    const meta: Record<string, string> = { full_name: form.full_name }
    if (form.phone.trim()) meta.phone = form.phone.trim()
    if (partner !== 'none') {
      meta.pending_partner = partner
      meta.partner_id = partnerId.trim()
    }
    const { data, error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: { data: meta },
    })
```

- [ ] **Step 3: Add the form fields**

No `<form>`, logo após o campo de Telefone (`<Input label="Telefone" ... />`), inserir:

```tsx
        <label className="text-sm text-slate-300">
          Você usa Gympass ou TotalPass?
          <select
            value={partner}
            onChange={(e) => setPartner(e.target.value as 'none' | 'wellhub' | 'totalpass')}
            className="mt-1 block w-full bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
          >
            <option value="none">Não uso</option>
            <option value="wellhub">Gympass (Wellhub)</option>
            <option value="totalpass">TotalPass</option>
          </select>
        </label>
        {partner !== 'none' && (
          <Input
            label="ID do Gympass/TotalPass"
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
            required
          />
        )}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/(auth)/cadastro/page.tsx"
git commit -m "feat(cadastro): seletor de parceiro, ID e telefone no signup"
```

---

## Task 4: Actions — limpar pendência ao confirmar; recusar

**Files:**
- Modify: `features/checkin/actions.ts`

- [ ] **Step 1: `setStudentType` limpa `pending_partner`**

Em `features/checkin/actions.ts`, na função `setStudentType`, adicionar `pending_partner: null` aos dois `update`:

No branch subscriber, trocar:
```ts
      .update({ payment_type: 'subscriber', monthly_checkin_target: 0 })
```
por:
```ts
      .update({ payment_type: 'subscriber', monthly_checkin_target: 0, pending_partner: null })
```

No branch de parceiro, trocar:
```ts
    .update({
      payment_type: input.type,
      [idColumn]: input.partnerId.trim() || null,
      monthly_checkin_target: input.monthlyTarget,
    })
```
por:
```ts
    .update({
      payment_type: input.type,
      [idColumn]: input.partnerId.trim() || null,
      monthly_checkin_target: input.monthlyTarget,
      pending_partner: null,
    })
```

- [ ] **Step 2: Append `clearPendingPartner`**

Adicionar ao final de `features/checkin/actions.ts`:

```ts
/** Recusa a solicitação de parceiro autodeclarada: limpa pending_partner. */
export async function clearPendingPartner(studentId: string): Promise<{ error?: string }> {
  const { ok } = await requireAdmin()
  if (!ok) return { error: 'Sem permissão de administrador.' }

  const adminClient = createAdminClient()
  const { error } = await adminClient
    .from('profiles')
    .update({ pending_partner: null })
    .eq('id', studentId)

  if (error) return { error: 'Erro ao recusar solicitação.' }

  revalidatePath(`/admin/alunos/${studentId}`)
  return {}
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add features/checkin/actions.ts
git commit -m "feat(cadastro): setStudentType limpa pendencia; action clearPendingPartner"
```

---

## Task 5: Banner de solicitação pendente no perfil

**Files:**
- Modify: `app/(admin)/admin/alunos/[id]/page.tsx`
- Modify: `app/(admin)/admin/alunos/[id]/StudentProfileClient.tsx`

- [ ] **Step 1: page.tsx — passar `pendingPartner`**

Em `app/(admin)/admin/alunos/[id]/page.tsx`, no `<StudentProfileClient ... />`, adicionar a prop (perto das demais props de parceiro):

```tsx
          pendingPartner={student.pending_partner}
```

(`student` vem de `select('*')`, então `pending_partner` está disponível após a migration.)

- [ ] **Step 2: StudentProfileClient — prop e estado**

Em `StudentProfileClient.tsx`, adicionar à `interface StudentProfileClientProps`:

```ts
  pendingPartner: 'wellhub' | 'totalpass' | null
```

Adicionar ao import de actions (junto de `setStudentType, recordCheckin`):

```ts
import { setStudentType, recordCheckin, clearPendingPartner } from '@/features/checkin/actions'
```

Desestruturar o parâmetro (junto dos outros):

```ts
  pendingPartner,
```

Adicionar estado (após `const [checkinsDone, ...]`):

```ts
  const [pending, setPending] = useState<'wellhub' | 'totalpass' | null>(pendingPartner)
```

- [ ] **Step 3: StudentProfileClient — handlers**

Adicionar (junto dos outros `handle...`):

```ts
  function handleConfirmPartner() {
    if (!pending) return
    const target = parseInt(targetInput, 10)
    if (Number.isNaN(target) || target < 0) {
      setError('Defina uma meta mensal válida antes de confirmar.')
      return
    }
    const declaredId = (pending === 'wellhub' ? wellhubId : totalpassId) ?? ''
    setError(null)
    startTransition(async () => {
      const result = await setStudentType(studentId, {
        type: pending,
        partnerId: declaredId,
        monthlyTarget: target,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      setLinkedPartner(pending)
      setStudentTypeState(pending)
      setPending(null)
      notify('Parceiro confirmado.')
    })
  }

  function handleRejectPartner() {
    setError(null)
    startTransition(async () => {
      const result = await clearPendingPartner(studentId)
      if (result.error) {
        setError(result.error)
        return
      }
      setPending(null)
      notify('Solicitação recusada.')
    })
  }
```

- [ ] **Step 4: StudentProfileClient — banner JSX**

Dentro da seção "Tipo de aluno", logo após `<h3 ...>Tipo de aluno</h3>`, inserir:

```tsx
        {pending && (
          <div className="mb-3 p-3 rounded-lg border border-yellow-700/50 bg-yellow-950/30">
            <p className="text-sm text-yellow-200">
              Solicitação de parceiro pendente:{' '}
              <strong>{pending === 'wellhub' ? 'Gympass (Wellhub)' : 'TotalPass'}</strong>
              {' · ID '}
              <span className="font-mono">
                {(pending === 'wellhub' ? wellhubId : totalpassId) || '—'}
              </span>
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Defina a meta mensal abaixo e confirme.
            </p>
            <div className="flex gap-2 mt-2">
              <Button onClick={handleConfirmPartner} disabled={isPending}>
                Confirmar
              </Button>
              <Button onClick={handleRejectPartner} disabled={isPending} variant="secondary">
                Recusar
              </Button>
            </div>
          </div>
        )}
```

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "app/(admin)/admin/alunos/[id]/page.tsx" "app/(admin)/admin/alunos/[id]/StudentProfileClient.tsx"
git commit -m "feat(cadastro): banner de confirmacao/recusa de parceiro no perfil"
```

---

## Task 6: Badge "Parceiro pendente" na lista de alunos

**Files:**
- Modify: `app/(admin)/admin/alunos/page.tsx`

- [ ] **Step 1: Incluir `pending_partner` no select e no tipo**

Em `app/(admin)/admin/alunos/page.tsx`, no `.select(...)` da query de profiles, adicionar `pending_partner`:

```ts
    .select('id, full_name, level, payment_type, contract_active, is_dependent, parent_id, credits_balance, pending_partner')
```

E no tipo do `students` (`Pick<Profile, ...>`), adicionar `'pending_partner'`:

```ts
  const students = (profiles ?? []) as Pick<
    Profile,
    'id' | 'full_name' | 'level' | 'payment_type' | 'contract_active' | 'is_dependent' | 'parent_id' | 'credits_balance' | 'pending_partner'
  >[]
```

- [ ] **Step 2: Renderizar o badge**

No card do aluno, logo após o bloco do nome/dependente (depois do `</div>` que fecha o `<div className="min-w-0">`, antes do `<Badge variant="level">`), envolver ou adicionar. Para ficar simples, adicionar o badge abaixo do nome — substituir:

```tsx
                      {student.is_dependent && (
                        <span className="text-xs text-slate-500">Dependente</span>
                      )}
```

por:

```tsx
                      {student.is_dependent && (
                        <span className="text-xs text-slate-500">Dependente</span>
                      )}
                      {student.pending_partner && (
                        <span className="block text-xs text-yellow-400 mt-0.5">
                          Parceiro pendente
                        </span>
                      )}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/admin/alunos/page.tsx"
git commit -m "feat(cadastro): badge de parceiro pendente na lista de alunos"
```

---

## Task 7: Verificação final

- [ ] **Step 1: Test suite**

Run: `npm run test:run`
Expected: PASS (sem regressões; as falhas do diretório `octogent/` são alheias — ignorar).

- [ ] **Step 2: Lint + typecheck + build**

Run: `npm run lint && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 3: Manual smoke (requer a migration aplicada em dev/staging)**

1. Criar conta SEM parceiro, com telefone → conferir em `profiles` que `phone` foi salvo e `pending_partner` é null.
2. Criar conta escolhendo Gympass + ID → conferir `pending_partner='wellhub'`, `wellhub_id` preenchido, `payment_type` ainda no default.
3. Tentar criar conta com parceiro e ID vazio → form bloqueia com mensagem.
4. No admin: a lista mostra "Parceiro pendente" no aluno; abrir o perfil → banner aparece; definir meta e **Confirmar** → `payment_type` vira wellhub, meta setada, `pending_partner` zera, badge some.
5. Repetir e **Recusar** → `pending_partner` zera, `payment_type` permanece o default.

- [ ] **Step 4: Commit (se houver ajustes do smoke)**

```bash
git add -A
git commit -m "test(cadastro): ajustes apos verificacao manual"
```

---

## Self-Review — cobertura do spec

- Coluna `pending_partner` + trigger (phone, parceiro, ID) → Task 1.
- Tipo → Task 2.
- Form de cadastro (seletor + ID + telefone, validação) → Task 3.
- Confirmar (setStudentType limpa pendência) + Recusar (clearPendingPartner) → Task 4 + UI Task 5.
- Banner no perfil → Task 5.
- Badge na lista → Task 6.
- Segurança (sem efeito privilegiado até confirmar) → garantido: trigger não muda `payment_type`.
- Testes → Task 7 (suite + smoke; lógica é trigger/UI, sem novas funções puras).
- Fora de escopo (validação via API, notificação automática) → não incluídos, conforme spec.
