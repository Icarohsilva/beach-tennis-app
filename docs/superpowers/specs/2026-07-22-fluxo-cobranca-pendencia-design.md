# Fluxo de cobrança e pendência — Design

**Data:** 2026-07-22
**Contexto:** é a **Spec 3 de 3** da decomposição feita em 2026-07-16 (1. regras de acesso e crédito ✅ · 2. geração semanal da grade ✅ · **3. fluxo de cobrança/pendência**). A Spec 1 fez a dívida **nascer** (linha em `payments` na presença) e **bloquear** (`resolveClassAccess` → `blocked_by_debt`), mas não entregou nenhuma forma de **ver, cobrar, pagar ou dar baixa**. Hoje o aluno é barrado sem rota de saída dentro do app, e o admin vê uma lista de 20 pendências somente-leitura.

## Objetivo

Fechar o ciclo da dívida: o aluno enxerga o que deve e consegue quitar pelo app (Mercado Pago ou PIX+comprovante); o admin enxerga quem deve, cobra pelos canais que já existem e dá baixa.

## Decisões

| Tema | Decisão |
|---|---|
| Como o aluno paga | **Duas trilhas**: checkout Mercado Pago (baixa automática) **e** PIX + comprovante (baixa manual). Aluno escolhe |
| Tela do admin | **Duas seções na mesma tela**: aulas avulsas em aberto · assinaturas vencidas |
| Disparo da cobrança | **Manual** — admin clica "Cobrar" (individual ou em lote). Sem cron |
| Canais de cobrança | in-app + e-mail + push + **WhatsApp** (admin escolhe no disparo) |
| Quando bloqueia | `amount > 0` **E** passada a **carência** configurável (`debt_block_grace_days`, padrão 7) |
| Pendência de R$ 0 | Continua sendo **criada** (academia precisa ver), mas **não bloqueia** |
| Comprovante → desbloqueio | **Só após o admin confirmar**. Enviar comprovante NÃO desbloqueia |
| Estado "aguardando confirmação" | **Derivado** (`status='pending' AND receipt_url IS NOT NULL`), sem novo valor no enum |
| Bucket do comprovante | **Reusa `payment-receipts`** (já existe, dos torneios), convenção `{payment_id}/{user_id}/receipt.{ext}` |

---

## 1. Modelo de dados

Migration **aditiva**, sem alterar enums:

```sql
alter table payments
  add column if not exists receipt_url text,
  add column if not exists receipt_uploaded_at timestamptz,
  add column if not exists settled_by uuid references profiles(id),
  add column if not exists settled_method text;
```

- `receipt_url` — path do comprovante no bucket privado (não é URL pública).
- `receipt_uploaded_at` — permite exibir "aguardando conferência há X".
- `settled_by` / `settled_method` — auditoria da baixa manual (`dinheiro` | `pix` | `maquininha` | `outro`).

**Por que não mexer no enum `payment_status`:** `alter type ... add value` precisa ser statement isolado e já causou problema neste projeto. O estado "aguardando confirmação" é derivável sem ambiguidade:

| Estado exibido | Condição |
|---|---|
| Em aberto | `status='pending'` e `receipt_url is null` |
| Aguardando conferência | `status='pending'` e `receipt_url is not null` |
| Pago | `status='paid'` |

### Comprovante: reuso do bucket existente

O bucket privado `payment-receipts` já existe (`20260630000200_payment_receipts_bucket.sql`, criado para torneios): 5 MB, `image/jpeg|png|webp`. A policy de upload/leitura exige que **o 2º segmento do path seja o `auth.uid()`**:

```sql
(storage.foldername(name))[2] = auth.uid()::text
```

Adotando a convenção **`{payment_id}/{user_id}/receipt.{ext}`** — mesma forma do torneio (`{tournament_id}/{user_id}/...`) — **a RLS existente já cobre o caso novo sem policy adicional**. O admin lê via `createAdminClient()` (service role, bypassa RLS), igual ao fluxo de torneio.

## 2. Regra de bloqueio

Hoje `hasOpenDebt` = existe `payments` pendente com `session_id` não nulo. Passa a exigir **três** condições:

```
bloqueia  ⟺  session_id is not null
          AND amount > 0                              ← corrige o bug do R$ 0
          AND created_at <= (hoje − debt_block_grace_days)
```

- **`amount > 0`** conserta um furo real: `ensureClassDebt` grava `amount: 0` quando a academia não configurou `single_class_price` ([classDebt.ts:87](../../../features/financeiro/classDebt.ts)); como o bloqueio olhava só existência, uma academia sem preço configurado travava alunos com dívidas de R$ 0 indefinidamente.
- **Carência**: nova chave `debt_block_grace_days` em `system_settings` (padrão **7**), editável em `/admin/configuracoes`. Zero = bloqueia na hora.
- A pendência de R$ 0 **continua sendo criada** — é o registro de que o aluno entrou sem pagar.

`resolveClassAccess` **não muda**: continua recebendo `hasOpenDebt: boolean`. O que muda é **como esse booleano é calculado** no caller ([actions.ts:194-200](../../../features/aulas/actions.ts)). Mantém a função pura intacta e testada.

## 3. Aluno: ver e pagar

- **Banner de pendência** em `/financeiro` e na home: valor total em aberto, quantas aulas, e o estado — *"bloqueia em X dias"* ou *"você está bloqueado"* ou *"aguardando confirmação"*.
- **Bloqueio deixa de ser um beco sem saída**: onde hoje a reserva falha com `blocked_by_debt`, passa a exibir o valor devido + link direto para quitar.
- **Trilha A — Mercado Pago** (só se a academia tiver gateway conectado): gera preferência para aquela(s) pendência(s), `external_reference` aponta para o `payments.id`; o webhook dá baixa automática.
- **Trilha B — PIX + comprovante** (sempre disponível): exibe a chave PIX da academia, aluno anexa o comprovante (mesmo componente/bucket do torneio), a pendência passa a "aguardando conferência". **Continua bloqueado até o admin confirmar.**

Nova config em `system_settings` para a trilha B: `pix_key` e `pix_key_owner` (nome do beneficiário), editáveis em `/admin/configuracoes`. Sem chave configurada, a trilha B não é oferecida.

## 4. Admin: tela de cobrança

Nova rota **`/admin/financeiro/cobranca`**, adicionada ao `FinanceiroSubnav` existente. Owner-only (`requireOwner()`), como o resto de `/admin/financeiro`.

**Seção 1 — Aulas avulsas em aberto** (agregado **por aluno**, não linha a linha):

| Coluna | Conteúdo |
|---|---|
| Aluno | nome |
| Total devido | soma dos `amount` pendentes |
| Aulas | quantidade de pendências |
| Mais antiga | data da pendência mais antiga |
| Situação | Em aberto · Bloqueado · **Aguardando conferência** |

A linha do aluno **expande** para as pendências individuais (data da aula, valor, estado), porque a baixa acontece por linha de `payments`, não por aluno.

Ações:
- **Dar baixa** — disponível em duas granularidades: numa pendência específica, ou **"quitar todas"** do aluno (aplica a mesma baixa a todas as pendências abertas dele). Em ambos os casos grava `status='paid'`, `paid_at`, `settled_by` (admin logado) e `settled_method` escolhido.
- **Ver comprovante** — aprovar (→ dá baixa naquela pendência) ou rejeitar (limpa `receipt_url` e notifica o aluno com o motivo).
- **Cobrar** — dispara a notificação (§5) com o total em aberto do aluno.

Pendências **aguardando conferência sobem para o topo**, com "aguardando há X".

**Seção 2 — Assinaturas vencidas**: o que o card "Inadimplentes" já calcula hoje (`student_subscriptions` `past_due` / período vencido / último pagamento falhou). Ação: **Cobrar**.

**O card "Inadimplentes" da tela principal passa a somar as duas seções** — hoje conta só assinatura e ignora as dívidas de aula avulsa que a Spec 1 criou.

## 5. Cobrança manual

Botão **"Cobrar"** (individual ou lote) abre a escolha de canais e dispara via `notifyUsers` — infra já existente, multi-canal, best-effort por canal:

- `inapp` (garantido), `email`, `push`, `whatsapp`.
- Mensagem por academia (nome da org), com o valor devido e o link para quitar.
- Sem cron: nada sai sem o admin mandar.

## 6. Riscos e bordas

- **Webhook do Mercado Pago precisa saber dar baixa numa pendência avulsa.** O webhook atual trata assinatura/créditos/day use; quitar um `payments` de `type='per_class'` via `external_reference` **precisa ser verificado e possivelmente estendido** — confirmar no plano antes de assumir que funciona.
- **Tensão aceita (decisão do usuário):** carência + desbloqueio só após conferência ⇒ quem paga PIX de madrugada antes da aula cedo segue travado. Mitigação: comprovantes pendentes no topo da tela e no KPI. *(Follow-up possível, fora deste escopo: push para o admin quando chega comprovante.)*
- **Escopo multi-tenant:** dívida e bloqueio são por academia. Confirmar que o cálculo de `hasOpenDebt` é escopado por `organization_id` — um aluno com dívida na academia A não pode ser bloqueado na B.
- **Dependentes:** a dívida nasce no `student_id` do dependente, mas quem paga é o `parent_id`. O responsável precisa **ver e quitar** a pendência do dependente; decidir no plano se a trilha de pagamento aceita pagar em nome de outro.
- **Efeito retroativo da carência:** ao aplicar, pendências antigas já passaram da carência e seguem bloqueando (correto). As de R$ 0 **deixam de bloquear** — é exatamente a correção pretendida.
- **Comprovante rejeitado** deve notificar o aluno com o motivo, senão ele fica sem entender por que continua bloqueado.
- **Tipos de pendência:** a tela cobre pendências com `session_id` (cobre `per_class` e `trial`), mesma definição usada pelo bloqueio.

## 7. Fora de escopo

- Cobrança automática por cron (decisão: manual).
- Estorno/reembolso de pendência paga (o fluxo de refund de day use já existe à parte).
- Parcelamento / negociação de dívida.
- Cobrança da academia para a plataforma (SaaS) — é outra spec.

## Cobertura do pedido original

| Pedido (2026-07-16) | Seção |
|---|---|
| Relatório de inadimplentes | 4 |
| Baixa | 1, 4 |
| Cobrança e-mail + push | 5 |
| Bloqueio | 2 |
| PIX no app com comprovante | 1, 3 |
