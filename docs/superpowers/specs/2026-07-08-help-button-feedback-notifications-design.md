# Botão de ajuda inline, feedback e melhorias no sininho

Data: 2026-07-08

## Contexto e problema

1. **Sobreposição de botões flutuantes.** O `HelpButton` renderiza `fixed` em `bottom-24 right-4` (aluno) e `bottom-4 right-4` (admin). Na comunidade, o FAB "+" fica em `fixed bottom-20 right-4`, e o botão de ajuda cobre parcialmente o "+". Ver [components/tour/HelpButton.tsx:25](../../../components/tour/HelpButton.tsx) e [app/(dashboard)/comunidade/ComunidadeClient.tsx:60](../../../app/(dashboard)/comunidade/ComunidadeClient.tsx).
2. **Sem canal de feedback.** Não há como o usuário reportar bug, elogiar ou sugerir ideias dentro do app.
3. **Sininho limitado.** O `NotificationBell` só marca tudo como lido. Não permite excluir notificações individualmente (a lista cresce indefinidamente), não mostra quem enviou, e o layout pode ficar apertado.

## Decisões tomadas (via brainstorming)

- Feedback vai **só para o dono da plataforma** (`is_platform_admin`), agregando todas as academias. Bug/feature são coisas do produto, não da academia.
- "Quem enviou" no sininho é derivado do **tipo** da notificação (nome da academia para `admin_message`, "Sistema" para o resto) — **sem coluna nova**.
- Excluir notificação é **hard delete** (remove a linha).
- O botão de ajuda deixa de ser flutuante e vira **inline** tanto no aluno quanto no admin.

## Escopo

### 1. Reposicionar o botão de ajuda

Adicionar suporte a modo **inline** (sem `fixed`) ao `HelpButton`.

- Novo prop `inline?: boolean` (default `false`, preserva o comportamento flutuante para não quebrar outros usos).
- Quando `inline`, o wrapper externo deixa de ser `fixed z-50 ...` e o menu abre ancorado ao botão (posicionamento `absolute` relativo a um container `relative`). Como o botão fica no topo, o menu deve abrir **para baixo** (não `mb-2` acima).
- **Aluno:** em [app/(dashboard)/layout.tsx](../../../app/(dashboard)/layout.tsx), agrupar `HelpButton` (inline) e `NotificationBell` num flex à direita do header: `[ajuda] [sininho]`.
- **Admin:** em [app/(admin)/layout.tsx](../../../app/(admin)/layout.tsx), colocar o `HelpButton` inline no topo do painel (área do header/menu mobile), removendo o flutuante.
- O menu do HelpButton precisa suportar abertura para baixo quando inline. Como o botão de ajuda no topo tem pouco espaço à direita, alinhar o menu à direita (`right-0`).

Resultado: o FAB "+" da comunidade não é mais coberto.

### 2. Modal de feedback

Novo componente `components/feedback/FeedbackModal.tsx` (client), aberto por um novo item no menu do `HelpButton`:

- Item novo no menu: **"Enviar feedback"** (ícone `MessageSquarePlus`), abaixo de "Perguntas frequentes".
- Campos:
  - Seletor de categoria: **Bug** (🐞) · **Elogio** (💛) · **Ideia** (💡). Default: Bug.
  - Textarea **descrição** — obrigatória (mínimo ~5 caracteres).
  - Upload de **imagem opcional** — aceita jpeg/png/webp, máx 5 MB. Preview simples do arquivo selecionado.
- Submit chama server action `submitFeedback`. Em caso de sucesso, mostra "Recebemos seu feedback. Obrigado!" e fecha após confirmação.
- Erros exibidos inline (falha de upload, arquivo grande, etc.).

### 3. Persistência (migration)

Arquivo `supabase/migrations/20260708000100_feedback.sql`:

**Tabela `feedback`:**
```
id              uuid pk default gen_random_uuid()
user_id         uuid not null references profiles(id) on delete cascade
organization_id uuid references organizations(id) on delete set null
category        text not null check (category in ('bug','elogio','ideia'))
message         text not null
image_path      text
status          text not null default 'novo' check (status in ('novo','lido','resolvido'))
created_at      timestamptz not null default now()
```
Índice: `idx_feedback_created on feedback(created_at desc)`.

**RLS:**
- `enable row level security`.
- Insert: `authenticated` pode inserir a própria linha (`user_id = auth.uid()`).
- Select: apenas quem tem `is_platform_admin = true` (subquery em `profiles`). O painel super-admin lê via `createAdminClient()` (service role) de qualquer forma, mas a policy documenta a intenção e protege o acesso direto.
- Update (status): mesma condição de platform admin.

**Bucket `feedback-images`** (molde de `payment-receipts`):
- Privado, `file_size_limit` 5 MB, mime `image/jpeg,image/png,image/webp`.
- Path: `{user_id}/{uuid}.{ext}`.
- Policy de insert: `authenticated` só no próprio path (`(storage.foldername(name))[1] = auth.uid()::text`).
- Leitura pelo painel via service role (sem policy extra necessária).

### 4. Server action de feedback

`features/feedback/actions.ts`:
- `submitFeedback(input)` — valida usuário logado, resolve `organization_id` ativo, faz upload da imagem (se houver) no bucket, insere linha em `feedback`. Retorna `{ ok: true }` ou `{ ok: false, error }`.
- O upload usa o client do usuário (RLS garante path próprio); a inserção idem.

### 5. Painel super-admin de feedback

- Nova página `app/(super-admin)/super-admin/feedback/page.tsx`:
  - Lê via `createAdminClient()` todos os feedbacks (join com `profiles` para nome de quem enviou e `organizations` para nome da academia), ordenados por `created_at desc`.
  - Para imagens, gerar signed URL do bucket privado.
  - Filtro por categoria (bug/elogio/ideia) e por status.
  - Cada item mostra: categoria (badge), mensagem, imagem (se houver), quem enviou, academia, data, status.
  - Botão para alternar status `novo → lido → resolvido` via server action.
- Adicionar link "Feedback" na home do super-admin ([app/(super-admin)/super-admin/page.tsx](../../../app/(super-admin)/super-admin/page.tsx)).

### 6. Melhorias no sininho

Em [components/ui/NotificationBell.tsx](../../../components/ui/NotificationBell.tsx):

- **Excluir individual:** botão `X` (ícone `X` do lucide) em cada item → chama nova server action `deleteNotification(id)` que faz hard delete (`delete ... where id = ? and user_id = auth.uid()`). Remove da lista local no sucesso (optimistic).
- **Quem enviou:** novo prop `orgName?: string` passado pelo layout. Rótulo por item derivado do `type`:
  - `admin_message` → `orgName` (nome da academia); se ausente, "Academia".
  - qualquer outro → "Sistema".
  Exibido como label pequeno junto ao título.
- **Layout/tamanho:** itens mais compactos, garantir que o `X` não empurre o texto, painel responsivo (largura confortável em telas pequenas), scroll mantido (`max-h-96 overflow-y-auto`).

Em `features/notificacoes/actions.ts`: adicionar `deleteNotification(id: string)`.

## Fora de escopo (YAGNI)

- Notificar o platform admin quando chega feedback (ele consulta o painel).
- Coluna de autor humano nas notificações.
- Soft-delete/arquivamento de notificações.
- Responder o feedback dentro do app (só marcar status).

## Arquivos afetados

Novos:
- `components/feedback/FeedbackModal.tsx`
- `features/feedback/actions.ts`
- `supabase/migrations/20260708000100_feedback.sql`
- `app/(super-admin)/super-admin/feedback/page.tsx` (+ componente client de lista se necessário)

Alterados:
- `components/tour/HelpButton.tsx` (modo inline + item de feedback)
- `app/(dashboard)/layout.tsx` (help inline no header)
- `app/(admin)/layout.tsx` (help inline no topo)
- `components/ui/NotificationBell.tsx` (excluir, remetente, layout)
- `features/notificacoes/actions.ts` (`deleteNotification`)
- `app/(super-admin)/super-admin/page.tsx` (link para feedback)

## Testes

- O projeto usa Vitest para utils. As mudanças aqui são majoritariamente UI + server actions com Supabase, sem util pura nova. Não há teste unitário óbvio a adicionar; validação será manual (fluxo de envio de feedback, exclusão de notificação, posicionamento dos botões). Se surgir lógica pura (ex: derivação do rótulo de remetente), extrair para função testável e cobrir com Vitest.
