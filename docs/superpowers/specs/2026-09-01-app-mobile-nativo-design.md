# App mobile nativo (React Native/Expo) e publicação na Play Store — Design

Data: 2026-09-01

## Contexto

O ArenaHub hoje é um PWA: Next.js 14 na Vercel, instalável pelo Chrome, com Web Push
próprio (`public/sw.js`), manifest completo e domínio `arenahub.website`. Funciona, mas não
existe na Play Store — o aluno não encontra o app buscando "ArenaHub", e a academia não tem
o que mostrar quando alguém pergunta "tem app?".

O objetivo é um app Android publicado na Play Store, e em seguida iOS.

Três caminhos foram avaliados: **TWA/Bubblewrap** (o site rodando em Chrome sem barra de
endereço), **Capacitor** (WebView próprio com ponte nativa) e **React Native/Flutter**
(interface reescrita). A decisão foi a terceira, com React Native — registrada em §Decisões
com o custo que ela implica.

## O que foi medido antes de decidir

| | |
|---|---|
| Telas do aluno (`app/(dashboard)/`) | 14 |
| Telas do admin (`app/(admin)/`) | 25 |
| Telas do super-admin (`app/(super-admin)/`) | 8 |
| Server actions exportadas | **207**, em 54 arquivos |
| Chamadas a `createAdminClient()` (service role, ignora RLS) | **644** |
| Componentes `'use client'` | 167 |

O número que dita o cronograma é **644**. Cada uma dessas chamadas é uma escrita que hoje é
segura *porque só o servidor a executa*. Um cliente nativo não pode chamar server action:
cada operação precisa virar rota autenticada com verificação de permissão própria, ou
política RLS em que se confie. Feito às pressas, é assim que se abre a base inteira de todas
as academias.

Consequência de escopo: **"reescrever a interface" é, neste projeto, construir a API do
produto inteiro e depois reescrever a interface.** A segunda metade é a menor.

## Decisões

1. **React Native com Expo**, não Flutter. Não é preferência: toda a lógica pura de `lib/`
   (`creditRules`, `accessRules`, `dateHelpers`, `liga/*`, `checkin/selfCheckin`,
   `aulas/classRules`) é TypeScript sem framework e roda no celular **sem reescrita**, com os
   testes Vitest que já passam. Em Dart, essas regras existiriam em duas linguagens: mudar a
   janela de cancelamento de 5h passaria a exigir duas edições, e no dia em que divergissem o
   app prometeria o que o servidor não cumpre.

2. **Entrega por strangler fig, não big bang.** O app nasce como casca nativa que renderiza
   em WebView autenticada as telas ainda não migradas, e cada tela vira nativa quando a API
   dela fica pronta. Big bang significaria 5 meses sem app na loja e sem o relógio dos 12
   testadores rodando (§Play Store). O destino é 100% nativo; o primeiro passo é
   indistinguível de um wrapper — de propósito.

3. **O app cobre o produto inteiro**, aluno e admin. O admin é o último a virar nativo e
   viaja em WebView até lá, mas está no roteiro, não fora dele.

4. **O Next.js continua sendo o backend.** Não há reescrita de servidor: as server actions
   ganham rotas equivalentes em `app/api/`, reaproveitando as mesmas funções. O Supabase
   continua sendo acessado pelos wrappers de `lib/supabase/`.

5. **O repositório vira workspace, mas o app web não sai da raiz.** Movê-lo para `apps/web`
   quebraria os aliases `@/`, a configuração da Vercel e os testes, sem ganho. Entram apenas
   `packages/dominio/` (TS puro compartilhado) e `mobile/` (Expo).

6. **`packages/dominio` nasce vazio e cresce por demanda.** Cada módulo puro migra para lá
   quando a primeira tela nativa precisar dele. Mover os 20 arquivos de uma vez é um refactor
   grande de valor nenhum antes de existir consumidor.

7. **Sessão nativa é por token; a ponte WebView troca token por cookie.** O app guarda a
   sessão Supabase em `expo-secure-store`; as telas web dentro dele precisam dos cookies
   `sb-*` que o `@supabase/ssr` espera. Uma rota dedicada faz essa troca (§Ponte de sessão).

8. **Push migra para FCM/APNs, sem tocar em `notifyUsers`.** `push_subscriptions` ganha
   `provider ('web' | 'fcm' | 'apns')` e o `sendPush` escolhe o transporte **por linha** — o
   mesmo usuário recebe no navegador e no app. Toda a árvore de notificação acima disso fica
   intacta.

9. **Biometria é tranca do app, não login novo.** A sessão Supabase já persiste; o que falta
   é o app pedir digital ao abrir (`expo-local-authentication`), como app de banco. Não toca
   no fluxo de auth. Passkeys/WebAuthn ficam fora — resolveriam um problema que não existe.

10. **`expo-updates` (OTA) ligado desde o primeiro build.** Correção de JS chega ao aluno sem
    passar por revisão do Google. Só mudança nativa (plugin, permissão, ícone) exige envio.

11. **Nome do pacote `website.arenahub.app`, congelado para sempre.** Trocar depois de
    publicado significa app novo, com zero instalações e zero avaliações.

## Estratégia de entrega — os sub-projetos

Cada sub-projeto tem spec e plano próprios. Este documento desenha o **1** em detalhe e fixa
o roteiro dos demais.

| # | Sub-projeto | Entrega |
|---|---|---|
| **1** | **Fundação e primeira publicação** | App real na Play Store em teste fechado, relógio dos 14 dias rodando |
| 2 | API e auditoria das 644 escritas | Rotas autenticadas por domínio; classificação RLS vs. rota |
| 3 | Núcleo do aluno nativo — Home, Agendar, Aulas | ~70% do uso, nativo |
| 4 | Liga nativa | Ranking, medalhas, elogios, mural |
| 5 | Perfil e Financeiro nativos | Inclui pagamento (§Pagamento) |
| 6 | Torneios e Comunidade nativos | Fecha a área do aluno |
| 7 | QR Code e widget | Features novas, decisão de produto própria |
| 8 | Painel da academia nativo | Último; WebView cobre até aqui |

Os sub-projetos 2 e 3–6 andam casados: a fatia da API de um domínio é feita junto com as
telas daquele domínio, nunca 207 rotas de uma vez.

---

# Sub-projeto 1 — Fundação e primeira publicação

## Objetivo

Um app instalável pela Play Store, com login, navegação nativa, push funcionando e todas as
telas atuais acessíveis (em WebView), publicado em teste fechado. Nenhuma tela nativa de
produto ainda — a fundação é o produto desta fase.

## Estrutura do repositório

```
/                     package.json com "workspaces": ["packages/*", "mobile"]
                      app/ features/ lib/ …   (Next.js, permanece na raiz)
packages/dominio/     TS puro compartilhado (nasce vazio — decisão 6)
mobile/               projeto Expo
  app/                Expo Router: abas nativas
  src/sessao/         Supabase + SecureStore + refresh por AppState
  src/ponte/          WebView autenticada
  src/nativo/         push, biometria, rede
```

## Ponte de sessão — o mecanismo que sustenta o strangler

É a peça crítica: sem ela, o aluno logaria no app e a WebView pediria login de novo.

- O app autentica direto no Supabase e guarda `access_token`/`refresh_token` em
  `expo-secure-store` (Keychain/Keystore), nunca em `AsyncStorage`.
- Antes de abrir a primeira WebView, o app faz **POST** para uma rota nova
  (`app/api/auth/sessao-nativa/route.ts`) enviando os dois tokens.
- A rota **valida os tokens contra o Supabase** e só então grava os cookies `sb-*` httpOnly,
  usando o mesmo helper de `lib/supabase/server.ts` que o resto do app usa. Nada de montar
  cookie na mão.
- Requisitos não negociáveis: POST (nunca query string — token em URL vaza para log de
  servidor e histórico), `SameSite=Lax`, `Secure`, e resposta sem corpo.
- Renovação: quando o app renova a sessão, refaz a troca. A WebView não renova sozinha.

Essa rota é a única superfície nova de autenticação do projeto e concentra o risco de
segurança da fase. Ela depende de `/api` já estar fora do matcher do `middleware.ts` (está) e
é alvo obrigatório de teste.

## Navegação

Abas nativas espelhando o `BottomNav` atual (Explorar, Arena, Home, Liga, Perfil), com a
mesma decisão de entrada de `app/inicio/page.tsx`: quem é staff da academia ativa cai no
painel, o resto cai na home. A regra não é duplicada em TypeScript no app — o app pergunta ao
servidor e obedece.

## Push

- `expo-notifications` sobre FCM (Android) e APNs (iOS).
- Migration: `push_subscriptions` ganha `provider` com default `'web'` (as linhas existentes
  são web push e continuam válidas).
- `lib/notifications/push.ts` passa a despachar por `provider`; `notifyUsers` e todos os
  gatilhos ficam intocados.
- **Ganho de graça:** o toque na notificação passa a carregar `data.url`, resolvendo a
  pendência conhecida de o push sempre abrir `/home`.
- Configuração externa: projeto Firebase, `google-services.json` no build, service account
  nas envs da Vercel.

## Recursos nativos desta fase

| Recurso | Plugin | Nota |
|---|---|---|
| Tranca biométrica | `expo-local-authentication` | Opcional, ligável no Perfil |
| Detecção de rede | `expo-network` | Tela nativa de "sem conexão" — WebView sem internet é tela branca |
| Localização | `expo-location` | **Obrigatório**: o check-in por GPS não funciona em WebView sem `ACCESS_FINE_LOCATION` no manifesto e handler nativo. Sem isso o `SelfCheckinPanel` pede localização para sempre |
| Links externos | `expo-web-browser` | Mercado Pago, WhatsApp e Google Calendar abrem fora da WebView. Checkout dentro da WebView quebra o pagamento |
| Atualização OTA | `expo-updates` | Decisão 10 |

## Build

**EAS Build** (build na nuvem da Expo). Não exige Android Studio nem SDK instalados na
máquina — relevante porque não há ambiente Android configurado hoje.

---

# Play Store — conta, prazos e ficha

A conta será **pessoa física**. Duas consequências que decidem o cronograma:

1. **Nome e endereço pessoais ficam visíveis na ficha da loja.** É exigência do Google, não
   tem como esconder. Conta de organização (CNPJ + D-U-N-S) mostraria "ArenaHub". Reversível
   depois, mas trabalhoso.
2. **12 testadores instalados por 14 dias corridos** antes de liberar produção. O relógio só
   começa no primeiro build subido em teste fechado.

**A consequência prática que molda o plano:** builds novos podem ser enviados *durante* os 14
dias. Então o sub-projeto 1 sobe cedo e cru, e os sub-projetos seguintes acontecem com o
relógio já correndo. Terminar o app antes de começar o teste custaria semanas de calendário
por nada.

Etapas, na ordem:

1. Conta Google dedicada ao projeto (não a pessoal do dia a dia).
2. Play Console, taxa única de US$ 25.
3. Verificação de identidade (documento com foto) e endereço.
4. Criar o app: nome, idioma, categoria, gratuito/pago (**gratuito, e isso é irreversível**).
5. Ficha: título, descrição curta e longa, ícone 512×512, capa 1024×500, capturas de tela.
6. **Política de privacidade** — URL pública obrigatória. Já existe `app/legal/[slug]`;
   confirmar que a página cobre o que o app coleta.
7. **Data safety**: declarar localização (check-in), dados pessoais, fotos (mural) e
   identificadores de push. Declaração falsa aqui derruba o app.
8. Play App Signing ligado; chave de upload gerada e **guardada por você**.
9. Teste fechado com os 12 testadores → 14 dias → produção.

## Pagamento — a única questão séria de política

| Cobrança | Situação |
|---|---|
| Aluno compra crédito ou paga mensalidade de aula | **Isento.** Aula presencial é serviço do mundo real; Mercado Pago liberado |
| Academia paga a assinatura do ArenaHub (`/admin/assinatura`) | **Risco.** Software é bem digital; o Google pode exigir Play Billing |

Desenho conservador: dentro do app, `/admin/assinatura` mostra o estado da assinatura e
**não oferece fluxo de compra** — a contratação continua no navegador, onde o dono da
academia já se cadastrou.

O texto vigente da política do Google **deve ser conferido antes do primeiro envio**, e não
reproduzido de memória: é a regra cuja interpretação errada rende suspensão da conta.

## iOS

Fora deste sub-projeto, mas a escolha do Expo é o que o torna barato depois: o mesmo código
gera o app da App Store. O que muda é conta (US$ 99/ano, recorrente), APNs no lugar de FCM, e
uma revisão humana mais rigorosa — a Apple rejeita wrapper de site com mais frequência, o que
significa que o iOS deve entrar quando já houver telas nativas de verdade (sub-projeto 3 em
diante), não agora.

## Fora de escopo

- Telas nativas de produto (sub-projetos 3–6, 8)
- QR Code e widget (sub-projeto 7)
- Modo offline com dados locais — apenas detecção de rede
- Migração dos módulos de `lib/` para `packages/dominio` (decisão 6)
- Reescrita do super-admin: 8 telas de gestão do SaaS, uso exclusivo em desktop

## Riscos

| Risco | Mitigação |
|---|---|
| A rota de ponte de sessão vira a falha de segurança do projeto | POST, validação real do token, cookie httpOnly, testes dedicados |
| Google rejeita como "app que é só um site" | Push, biometria, localização e QR nativos são o argumento; a descrição da loja não pode prometer o que o app não faz |
| As 644 escritas com service role viram rotas sem verificação equivalente | Sub-projeto 2 classifica **cada uma** antes de expor; nenhuma rota nasce sem decisão explícita de permissão |
| Duas bases de UI convivendo por meses geram divergência de comportamento | Regra pura sempre em `packages/dominio`, consumida pelos dois lados |
| O relógio de 14 dias não começa por falta de 12 testadores reais | Recrutar os testadores é tarefa da fase 1, não do fim |
