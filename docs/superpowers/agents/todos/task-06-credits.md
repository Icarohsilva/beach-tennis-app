# TODO: Agent 06 — Subscription Initial Credits

**Branch:** `fix/task-06-credits`
**Issues fixed:** #7 (assinatura não calcula créditos do mês)

## Root Cause
`subscribeToPlan` in `features/financeiro/actions.ts` creates the subscription record
but NEVER inserts a `credit_transaction` or updates `profiles.credits_balance`.
Credits are only granted later via Mercado Pago webhook — not at subscription time.

## Tasks

- [ ] Read full plan: `docs/superpowers/plans/2026-06-01-15-correcoes-e-melhorias.md` (Task 6)
- [ ] Read `features/financeiro/actions.ts` fully
- [ ] Modify `subscribeToPlan` to also fetch `plan.credits_per_month` and `plan.name`
- [ ] After successful subscription insert (returns newSub.id), if credits_per_month > 0:
  - Insert `credit_transactions` row: type='renewed', amount=credits_per_month, reason='Créditos iniciais — plano {name}', subscription_id=newSub.id
  - Update `profiles.credits_balance = credits_per_month` for student
- [ ] The .select('id') .single() on insert must be added (currently doesn't select id)
- [ ] Run `npm run build` — must pass
- [ ] Commit: `git commit -m "fix: conceder créditos iniciais ao aluno ao assinar plano"`

## Key Code Change
Change the subscription insert to:
```typescript
const { data: newSub, error: insertErr } = await adminClient
  .from('student_subscriptions')
  .insert({ ...fields })
  .select('id')
  .single()
```
Then after: insert credit_transaction + update profiles.credits_balance.

## Completion

When done, update `docs/superpowers/agents/STATUS.md` row for agent-06-credits.
