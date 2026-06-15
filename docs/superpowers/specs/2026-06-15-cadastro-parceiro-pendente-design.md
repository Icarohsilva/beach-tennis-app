# Autodeclaração de Gympass/TotalPass no cadastro (com confirmação do admin)

**Data:** 2026-06-15
**Status:** Design aprovado (aguardando revisão do spec)

## Problema

No cadastro, a pessoa não consegue informar que usa Gympass (Wellhub) ou TotalPass. Hoje o trigger [handle_new_user](../../../supabase/migrations/003_profile_trigger.sql) cria o perfil lendo apenas `full_name`/`avatar_url` do metadata — inclusive o **telefone digitado no form não é salvo**. Queremos permitir que o aluno declare o parceiro + ID no cadastro, ficando **pendente** até o admin confirmar e definir a meta de check-ins. Quem não declara segue o fluxo normal (admin define o plano depois).

## Decisões (confirmadas com o usuário)

- **Modelo "aguarda admin confirmar":** a declaração no cadastro NÃO torna o aluno parceiro na hora. Fica pendente; `payment_type` continua o padrão até o admin confirmar.
- **Rótulo:** "Gympass (Wellhub)", salvo como `wellhub`. "TotalPass" salvo como `totalpass`.
- **ID obrigatório** quando um parceiro é escolhido.
- Corrigir de passagem: **salvar o telefone** no cadastro.

## Arquitetura

### 1. Dado de pendência (migration)

Nova migration em `supabase/migrations/` (timestamp novo):

```sql
alter table profiles
  add column if not exists pending_partner checkin_partner;
```

Reusa o enum `checkin_partner` (`wellhub`/`totalpass`) criado em `20260615000000_checkins.sql`. `pending_partner` nulo = sem solicitação pendente.

### 2. Trigger de criação de perfil

Atualizar `handle_new_user` para ler do `raw_user_meta_data` e gravar: `full_name`, `phone`, `pending_partner`, e — conforme o parceiro declarado — `wellhub_id` **ou** `totalpass_id`. `payment_type` permanece o default da tabela (`per_class`). Campos ausentes no metadata caem em `null`/default.

```sql
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

### 3. Form de cadastro

[app/(auth)/cadastro/page.tsx](../../../app/(auth)/cadastro/page.tsx):

- Adicionar um seletor "Você usa Gympass ou TotalPass?": **Não / Gympass (Wellhub) / TotalPass**.
- Se um parceiro for escolhido, exibir o campo **ID do parceiro** (obrigatório; bloquear submit se vazio).
- No `supabase.auth.signUp`, enviar em `options.data`: `full_name`, `phone`, e quando houver parceiro: `pending_partner` (`'wellhub'`/`'totalpass'`) e `partner_id`.
- Sem parceiro: envia só `full_name` e `phone` (fluxo atual + telefone).

### 4. Admin confirma/recusa

[StudentProfileClient.tsx](../../../app/(admin)/admin/alunos/[id]/StudentProfileClient.tsx) recebe `pendingPartner` (do `page.tsx`). Quando setado, mostra um destaque no topo da seção "Tipo de aluno":

> **Solicitação de parceiro pendente: Gympass (Wellhub) · ID `<wellhub_id>`** — [Confirmar] [Recusar]

- **Confirmar:** usa a meta informada (campo já existente) e chama o `setStudentType` existente (`{ type, partnerId, monthlyTarget }`), que grava `payment_type` + ID + meta; em seguida limpa `pending_partner`.
- **Recusar:** limpa `pending_partner` (mantém `payment_type` como está).

Nova action `resolvePartnerRequest(studentId, action: 'confirm' | 'reject', input?)` em `features/checkin/actions.ts`, ou estender o fluxo: para manter coeso, `setStudentType` passa a **limpar `pending_partner`** sempre que define o tipo; e adicionamos `clearPendingPartner(studentId)` para o "Recusar". (Detalhe de implementação fica no plano.)

### 5. Descoberta pelo admin (lista)

[/admin/alunos](../../../app/(admin)/admin/alunos/page.tsx): exibir um badge **"Parceiro pendente"** nos alunos com `pending_partner` setado, para o admin localizar as solicitações sem abrir cada perfil.

### 6. Segurança

Como nada privilegiado acontece até o admin confirmar (o aluno continua com `payment_type` padrão, sem acesso de parceiro), confiar no metadata auto-declarado no signup é aceitável. O `partner_id` é apenas o valor declarado; a validação real (API do parceiro) é trabalho futuro do adaptador.

## Erros & validação

- Form: se parceiro escolhido e ID vazio → bloqueia submit com mensagem.
- Confirmar sem meta válida → erro (reusa a validação do `setStudentType`).
- Metadata ausente/!= enum → trigger grava `null` (perfil normal).

## Testes

- **Trigger:** verificação manual no smoke (criar conta com e sem parceiro; conferir `profiles.pending_partner`, `phone`, `wellhub_id`).
- **Form:** validação de ID obrigatório (verificação manual).
- **Admin confirmar/recusar:** smoke — confirmar vira `payment_type` e zera `pending_partner`; recusar só limpa.

## Fora de escopo

- Validação do ID contra a API Gympass/TotalPass (futuro adaptador).
- Notificação automática ao admin de nova solicitação (basta o badge na lista).
- Auto-vínculo sem confirmação (decisão: aguarda admin).
