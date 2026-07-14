# Frente 1 — Comunicação (canais externos de notificação)

Data: 2026-07-14

**Programa:** item 1 de 5 (0. Endurecimento+Observabilidade ✅ · **1. Comunicação** · 2. BI · 3. Financeiro BR · 4. Escala & Qualidade)

## Contexto e problema

A plataforma já tem uma camada de notificação in-app (sininho, tabela `notifications`, `NotificationBell`) funcional. Mas os canais externos são **fachada**: a tela `/admin/notificacoes` mostra checkboxes de canal (Push/Email/WhatsApp), preview e contador de enviados, porém nada além do sininho realmente chega a alguém.

Estado atual mapeado no código:

- **E-mail** — `_sendEmailNotifications` em `features/comunidade/actions.ts` é só `console.log`. O pacote `resend` nem está nas dependências. `RESEND_API_KEY` existe no `.env.example` (valor real, nunca usado — achado de segurança da Frente 0, pendente de rotação em tarefa separada).
- **WhatsApp** — `_sendWhatsAppNotifications` lê `process.env.WHATSAPP_GATEWAY`, que **não existe** no `.env.example` (lá só há `ZAPI_TOKEN`, placeholder vazio — nomes não batem). Também só `console.log`.
- **Push** — `_sendPushNotifications` consulta a tabela `push_subscriptions`, que **não existe em nenhuma migration**. Não há service worker (`public/sw.js`) nem fluxo de permissão/assinatura no client. A opção "somente alunos com PWA instalado" filtra por uma tabela fantasma.

Consequência: o usuário só descobre que algo aconteceu se abrir o app e olhar o sininho. Além disso, eventos importantes (aula cancelada, vaga de espera, crédito baixo, assinatura em atraso) na maioria não geram notificação nenhuma — nem in-app.

## Decisões tomadas (via brainstorming)

- **Canais desta frente:** e-mail (Resend) + WhatsApp (Z-API). **Push fica fora** (próxima frente — exige service worker, tabela `push_subscriptions`, VAPID, fluxo de permissão).
- **Gateway de WhatsApp:** Z-API (condiz com o placeholder `ZAPI_TOKEN` já existente; usa um número comum via QR code, sem aprovação da Meta).
- **Escopo de gatilho:** broadcast manual do admin **+** 4 gatilhos transacionais automáticos.
- **Canais em transacional:** sempre todos os disponíveis (in-app sempre; e-mail sempre — vem do `auth.users`; WhatsApp se o aluno tiver telefone). Sem preferência por usuário nesta frente.
- **Uma spec só**, plano incremental (infra primeiro, cada gatilho como tasks incrementais).
- **Abordagem A:** helper central de disparo (`notifyUsers`), envio síncrono best-effort, cada canal em try/catch isolado que reporta ao Sentry mas nunca derruba a ação de origem.

## Arquitetura

### Módulos de envio (I/O puro, sem domínio)

**`lib/notifications/email.ts`**
- Instala o pacote `resend`.
- `sendEmail({ to, subject, html })` → `resend.emails.send`. Fail-closed sem `RESEND_API_KEY` (log + no-op).
- Remetente de `NOTIFICATIONS_FROM_EMAIL` (ex.: `Academia <no-reply@dominio.com>`; o Resend exige domínio verificado).

**`lib/notifications/whatsapp.ts`**
- `sendWhatsApp({ phone, message })` → `POST https://api.z-api.io/instances/{ZAPI_INSTANCE_ID}/token/{ZAPI_TOKEN}/send-text`, com header `Client-Token: {ZAPI_CLIENT_TOKEN}`.
- A Z-API exige **3** credenciais: Instance ID (URL) + Token (URL) + Client-Token (header). Adicionar `ZAPI_INSTANCE_ID` e `ZAPI_CLIENT_TOKEN` ao `.env.example` (placeholders vazios).
- Normaliza telefone pra formato internacional (mesma lógica de `buildWhatsAppUrl` em `lib/torneios/waitlist.ts`: remove não-dígitos, garante DDI 55).
- Fail-closed se faltar credencial.

Cada módulo recebe destino + conteúdo já prontos; não conhece aluno/aula. Testáveis com `fetch`/SDK mockado.

### Helper central — `lib/notifications/dispatch.ts`

```
notifyUsers(client, {
  orgId,
  recipients,   // [{ userId, email?, phone? }]
  type,         // 'admin_message' | 'waitlist_offer' | 'class_cancelled' | 'low_credits' | 'payment_past_due'
  title,
  body,
  channels,     // subconjunto de ['inapp', 'email', 'whatsapp']
})
```

Ordem de execução:
1. **In-app** (se `channels` inclui `inapp`): insere as linhas em `notifications` em batch (mesma escrita que alimenta o sininho hoje).
2. **E-mail** (se inclui `email`): para cada destinatário com `email`, chama `sendEmail`. Cada envio em try/catch isolado; erro → Sentry (`tags: { channel: 'email', notificationType: type }`).
3. **WhatsApp** (se inclui `whatsapp`): idem, para cada destinatário com `phone`.

**Resiliência (herdada da Frente 0):** disparo de canal externo **nunca** faz a ação de origem falhar. In-app é o canal garantido (insert no nosso banco); e-mail/WhatsApp são best-effort. Falha externa grita no Sentry, não na tela do usuário.

**Fan-out de conteúdo (montado no dispatch, não nos gatilhos):**
- In-app: `title`/`body` curtos (cabem no sininho).
- E-mail: template HTML simples e único (cabeçalho com nome da academia, corpo, rodapé).
- WhatsApp: texto puro (`*título*\n\ncorpo`).

Um canal futuro (push) entra aqui com uma linha.

### Busca de e-mail — view `public.user_emails`

`profiles` não tem e-mail; ele vive em `auth.users`. Broadcast pode mirar centenas de alunos — chamar a Admin Auth API por aluno seria lento e frágil.

Migration cria view somente-leitura exposta ao service role:

```sql
create view public.user_emails as
  select id, email from auth.users;

revoke all on public.user_emails from anon, authenticated;
grant select on public.user_emails to service_role;
```

O dispatch (service role) resolve N e-mails com um `.from('user_emails').select('id, email').in('id', userIds)`. Anon/authenticated não têm grant → não vaza e-mail via API pública. Gatilhos com um único `userId` usam a mesma view.

## Escopo detalhado

### 1. Broadcast manual do admin

Em `features/comunidade/actions.ts`, `sendNotification`:
- Remover os 3 helpers stub locais (`_sendEmailNotifications`, `_sendWhatsAppNotifications`, `_sendPushNotifications`).
- Montar `recipients` com `{ userId, phone }` (de `profiles`) + `email` (da view `user_emails`) e delegar a `notifyUsers(...)` com os `channels` selecionados na UI.
- O contador de "enviados" reflete os destinatários in-app (como hoje); e-mail/WhatsApp são best-effort e não alteram esse número.

Em `app/(admin)/admin/notificacoes/NotificacoesClient.tsx`:
- Desabilitar/ocultar o canal **"Push (PWA)"** e o filtro **"Somente alunos com PWA instalado"**, com rótulo "em breve". Evita selecionar um canal inerte e consultar a tabela fantasma `push_subscriptions`.

### 2. Gatilhos transacionais

Todos chamam `notifyUsers` com `channels: ['inapp', 'email', 'whatsapp']`.

**a) Vaga de espera liberada** — `features/aulas/waitlistActions.ts`, `offerWaitlistSpot`. Hoje já insere notificação in-app avulsa. Trocar esse insert por `notifyUsers` (1 destinatário: o próximo da fila). Tipo `waitlist_offer`. Maior urgência (janela de 1h pra confirmar).

**b) Aula cancelada pelo admin** — `features/aulas/adminActions.ts`, `deleteClass` (único ponto de cancelamento no código; cancela a turma inteira + sessões futuras + bookings + matrículas). Hoje não avisa ninguém. Antes de efetivar o cancelamento, coletar destinatários afetados: alunos com booking `confirmed` em sessões futuras da turma **+** alunos com matrícula fixa ativa, **deduplicados por `userId`**. Depois do cancelamento, disparar `notifyUsers` (tipo `class_cancelled`, mensagem com nome da turma). Coleta/envio best-effort — não reverte o cancelamento.

**c) Crédito caiu a 1** — o débito passa pela RPC `adjust_credits` (vários pontos de `features/aulas/actions.ts`). Lógica num só lugar: função `checkLowCreditThreshold(client, studentId, orgId)` chamada após cada débito. Dispara **só quando o saldo passou de >1 para exatamente 1 neste débito** (cruzamento); se já estava em 1 ou 0, não repete. Tipo `low_credits`. 1 destinatário.

**d) Assinatura em atraso (`past_due`)** — `app/api/webhooks/mercadopago/studentHandlers.ts`, `handleStudentPreapprovalEvent`, ramo `mapped === 'past_due'` (hoje só faz `update` de status). Adicionar `notifyUsers` (1 destinatário: o aluno dono da assinatura) avisando que a cobrança falhou e a assinatura está suspensa até regularizar. Tipo `payment_past_due`.

**Disciplina em (c) e (d):** rodam em caminhos sensíveis (RPC de crédito, webhook de pagamento). O envio entra **depois** da escrita crítica confirmada, sempre em try/catch que reporta ao Sentry — uma falha de notificação nunca corrompe crédito nem quebra o webhook (que faria o MP reentregar).

## Erros e observabilidade

- Todo envio externo em try/catch isolado, reportando ao Sentry com `tags: { channel, notificationType }` e `extra` mínimo (só IDs, sem PII no corpo).
- Nenhuma falha de canal externo propaga pra ação de origem (broadcast, `deleteClass`, webhook, débito de crédito).
- In-app é a fonte confiável: se o insert em `notifications` falhar, aí sim é erro real da ação (retornado ao chamador) — é o nosso próprio banco.

## Testes

Vitest co-localizado onde há lógica pura:
- `lib/notifications/whatsapp.ts` — normalização de telefone + montagem de URL/payload, com `fetch` mockado.
- `lib/notifications/email.ts` — fail-closed sem API key, formato do payload, com SDK mockado.
- `checkLowCreditThreshold` — regra "cruzou de >1 pra 1 dispara; já em 1/0 não repete".
- `dispatch.ts` — fan-out: dado `channels` e destinatários com/sem email/phone, chama os senders certos e isola falhas (um sender que lança não impede o outro).

Integração (broadcast real, `deleteClass`, webhook) fica em verificação manual — dependem de Supabase/rede.

## Fora de escopo (YAGNI)

- **Push/PWA** — próxima frente (service worker, tabela `push_subscriptions`, VAPID, permissão no navegador).
- **Preferência de canal por usuário** (opt-out de email/WhatsApp) — sem tabela de preferências; transacional sempre usa todos os canais disponíveis.
- **Fila assíncrona de envio** — envio síncrono best-effort basta no volume atual (uma academia, dezenas de alunos).
- **Templates ricos de e-mail** (múltiplos layouts, imagens) — um template HTML simples e único serve.
- **Rotação do `RESEND_API_KEY` exposto** — tarefa separada da Frente 0, já sinalizada; não misturada aqui.

## Novas variáveis de ambiente

Adicionar ao `.env.example` (placeholders):
```
NOTIFICATIONS_FROM_EMAIL=
ZAPI_INSTANCE_ID=
ZAPI_CLIENT_TOKEN=
```
Já existentes e reaproveitados: `RESEND_API_KEY` (valor real presente, pendente de rotação), `ZAPI_TOKEN`.

## Arquivos afetados

Novos:
- `lib/notifications/email.ts` (+ `.test.ts`)
- `lib/notifications/whatsapp.ts` (+ `.test.ts`)
- `lib/notifications/dispatch.ts` (+ `.test.ts`)
- `supabase/migrations/<timestamp>_user_emails_view.sql`

Alterados:
- `features/comunidade/actions.ts` (broadcast usa `notifyUsers`; remove stubs)
- `app/(admin)/admin/notificacoes/NotificacoesClient.tsx` (desabilita/oculta push + filtro PWA)
- `features/aulas/waitlistActions.ts` (waitlist_offer via `notifyUsers`)
- `features/aulas/adminActions.ts` (`deleteClass` notifica afetados)
- `features/aulas/actions.ts` (`checkLowCreditThreshold` após débito) — ou um módulo dedicado importado por ela
- `app/api/webhooks/mercadopago/studentHandlers.ts` (notificação em `past_due`)
- `.env.example` (novas vars)
- `package.json` (dependência `resend`)
