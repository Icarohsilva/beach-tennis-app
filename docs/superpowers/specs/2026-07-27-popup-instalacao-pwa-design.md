# Popup de instalação do app + aviso de notificações

**Data:** 2026-07-27
**Status:** aprovado, pronto para plano de implementação

## Problema

Hoje o convite para instalar o app e ativar notificações é um card discreto na
`/home` (`components/pwa/PushOnboardingCard.tsx`). Ele tem um `X` que grava
`pwa-onboarding-dismissed` no localStorage e **nunca mais volta**. Quem fecha uma
vez, por pressa ou sem querer, nunca mais é convidado a instalar nem a permitir
notificações — e notificação é o canal principal de aviso de aula cancelada, vaga
na fila e lembrete de treino.

Queremos um convite mais presente e mais fluido: um popup que reaparece até a
pessoa instalar, e um aviso permanente (mas leve) enquanto as notificações não
estiverem permitidas.

## Restrição de plataforma: iOS não pode ser automatizado

Safari no iOS **não** expõe `beforeinstallprompt` nem qualquer API de instalação.
A única via é o usuário tocar em Compartilhar → "Adicionar à Tela de Início",
usando UI do sistema operacional, fora do alcance da página. Portanto:

- **Android / Chrome / Edge:** instalação com um toque, via prompt nativo.
- **iOS:** passo a passo obrigatório. Investimos em deixá-lo bom (animado,
  apontando o botão certo) em vez de tentar automatizar o impossível.

Corolário importante: no iOS, **push só funciona depois de instalado**. Pedir
permissão de notificação a um usuário de iPhone que ainda não instalou não
funciona e só confunde. A ordem no iOS é sempre instalar → depois notificar.

## Decisões

| Questão | Decisão |
|---|---|
| Quão duro é o "obrigar a permitir notificações" | Aviso insistente que **não bloqueia** o app |
| Frequência do popup de instalar após "Agora não" | 1x por dia |
| Produção do vídeo do passo a passo | Animação HTML/CSS + export para GIF |
| Quem vê | Aluno e admin, **apenas em telas de celular** |

Sobre o não-bloqueio: um gate real é tecnicamente possível, mas se a pessoa
clicar "Bloquear" no prompt do navegador, o navegador grava `denied` de forma
permanente e ela fica travada fora do app sem saída. Insistir sem bloquear
converte quase igual e não cria becos sem saída.

## O que sai

- `components/pwa/PushOnboardingCard.tsx` — deletado.
- `lib/pwa/onboardingState.ts` + `onboardingState.test.ts` — substituídos por
  `lib/pwa/promptState.ts`.
- A montagem do card em `app/(dashboard)/home/page.tsx`.
- A chave de localStorage `pwa-onboarding-dismissed` (dismiss permanente).

**Fica:** `features/perfil/NotificationToggle.tsx` — é o controle manual no
perfil, sem insistência, e continua sendo a forma de desligar push depois.
**Fica:** `lib/pwa/pushClient.ts` inteiro (`subscribeToPush` etc.) — a nova UI
chama os mesmos helpers.

## Arquitetura

### Módulos

| Arquivo | Papel | Depende de |
|---|---|---|
| `lib/pwa/environment.ts` | Lê o ambiente do browser: `isIOS`, `isAndroid`, `isMobile`, `standalone`, `isInAppBrowser`, `pushSupported`. Impuro por natureza; client-only. | `navigator`, `window` |
| `lib/pwa/promptState.ts` | **Puro.** `resolvePrompt(input) → PromptDecision`. Toda a regra de negócio mora aqui. | nada |
| `lib/pwa/dismissStorage.ts` | Lê/grava o timestamp de dispensa no localStorage, com a janela de 24h. Tolera localStorage indisponível. | `localStorage` |
| `components/pwa/InstallGate.tsx` | Orquestrador client. Monta o ambiente, chama `resolvePrompt`, renderiza sheet ou faixa, escuta `beforeinstallprompt` / `appinstalled`. | os três acima |
| `components/pwa/InstallSheet.tsx` | O popup em si (bottom sheet). Variantes iOS, Android e in-app browser. | `IosInstallAnimation` |
| `components/pwa/IosInstallAnimation.tsx` | A animação do passo a passo. Sem estado externo, sem props obrigatórias — reusável em três contextos. | nada |
| `components/pwa/PushNagBanner.tsx` | A faixa de notificações, com os estados "pedir" e "bloqueado". | `lib/pwa/pushClient` |
| `app/(public)/instalar/page.tsx` | Página pública compartilhável com a animação e os passos. | `IosInstallAnimation` |
| `scripts/gerar-video-instalacao.mjs` | Gera o GIF a partir da página `/instalar`. | Playwright, sharp |

A separação que importa: **`promptState.ts` não toca em browser nenhum**. Recebe
um objeto descrevendo o ambiente e devolve uma decisão. Isso é o que torna a
matriz de plataformas testável sem simular Safari.

### A decisão

```ts
type PromptInput = {
  isMobile: boolean
  isIOS: boolean
  isInAppBrowser: boolean   // Instagram, Facebook, etc.
  standalone: boolean       // já instalado
  installable: boolean      // beforeinstallprompt capturado
  pushSupported: boolean
  permission: NotificationPermission
  dismissedAt: number | null
  now: number
}

type PromptDecision =
  | 'none'
  | 'install-ios'          // sheet com animação
  | 'install-ios-inapp'    // "abra no Safari primeiro"
  | 'install-android'      // sheet com botão nativo
  | 'push-ask'             // faixa: ativar notificações
  | 'push-blocked'         // faixa: como desbloquear
```

Regras, avaliadas em ordem:

1. `!isMobile` → `none`. Desktop nunca vê nada.
2. `standalone`:
   - `permission === 'granted'` → `none`
   - `permission === 'denied'` → `push-blocked`
   - senão → `push-ask`
3. `isIOS && !standalone`:
   - `isInAppBrowser` → `install-ios-inapp`
   - dispensado há menos de 24h → `none`
   - senão → `install-ios`
   - (nunca `push-*`: push no iOS exige instalação)
4. `!isIOS && !standalone && installable`:
   - dispensado há menos de 24h → `none`
   - senão → `install-android`
5. Restante (Android sem o evento, browser sem suporte a instalação):
   - `!pushSupported` → `none`
   - `permission === 'granted'` → `none`
   - `permission === 'denied'` → `push-blocked`
   - senão → `push-ask`

### Frequência e dispensa

- **Sheet de instalação:** dispensável. "Agora não" e o `X` gravam
  `arenahub-install-dismissed-at = Date.now()`. Reaparece após 24h. Quando o
  evento `appinstalled` dispara ou `standalone` vira true, some para sempre.
- **Faixa de push:** **não tem botão de fechar.** Fica visível enquanto a
  permissão não for concedida e some sozinha no instante em que for. É uma faixa
  fina abaixo do header, não um modal — não bloqueia navegação nem cobre
  conteúdo.

`dismissStorage` deve tolerar:
- localStorage indisponível (Safari em navegação privada **lança exceção** ao
  escrever) → trata como "nunca dispensado", nunca quebra a página;
- valor corrompido / não numérico → trata como null;
- timestamp no futuro (relógio do device errado) → trata como null, senão o
  popup some por tempo indeterminado.

### Montagem

`<InstallGate />` entra em dois lugares:

- `app/(dashboard)/layout.tsx` — área do aluno
- `app/(admin)/layout.tsx` — painel da academia

O gate se auto-suprime no desktop, então não precisa de condicional no layout.
A faixa renderiza logo abaixo do header fixo. O sheet é `position: fixed` e
precisa ficar acima do `BottomNav`, que usa `z-50`, e abaixo do `FaqModal`, que
usa `z-[60]` — então backdrop e sheet usam `z-[55]`.

`app/(public)/layout.tsx` é um layout mínimo sem guards de auth, sem BottomNav e
sem sidebar, então `/instalar` cai nele sem adaptação.

### Captura do `beforeinstallprompt`

O evento dispara cedo, muitas vezes antes de o React hidratar, e se ninguém
chamar `preventDefault()` ele é consumido. Solução: um script inline no
`app/layout.tsx` que roda antes da hidratação, chama `preventDefault()` e guarda
o evento em `window.__arenahubInstallEvent`, além de setar uma flag. O
`InstallGate` lê essa variável na montagem **e** registra o listener normal (o
evento pode disparar depois, em navegação client-side).

## Conteúdo e tom

O objetivo é convidar, não pressionar. Nada de "obrigatório", "atenção" ou tom de
erro. Sem tela vermelha.

| Estado | Título | Corpo | Ações |
|---|---|---|---|
| `install-ios` | "Bota o ArenaHub na sua tela de início 🏐" | "10 segundos e suas aulas ficam a um toque." | `Ver como faz` (abre a animação) · `Agora não` |
| `install-ios-inapp` | "Quase lá! Abre no Safari primeiro 🧭" | "Por aqui o iPhone não deixa instalar. Toque nos três pontinhos e escolha 'Abrir no Safari'." | `Copiar link` · `Agora não` |
| `install-android` | "Instalar o ArenaHub?" | "Um toque e ele vira app de verdade no seu celular." | `Instalar` (prompt nativo) · `Agora não` |
| `push-ask` | — (faixa de uma linha) | "🔔 Tá faltando combinar o principal: aula cancelada, vaga na fila, lembrete de treino." | `Ativar` |
| `push-blocked` | — (faixa de uma linha) | "🔔 As notificações estão bloqueadas no navegador. Toque no cadeado 🔒 ao lado do endereço pra liberar." | `Como faço` (link para a FAQ) |

Visual: bottom sheet com fundo `bg-surface-card`, borda `border-surface-border`,
cantos superiores arredondados, entrando de baixo — o mesmo padrão do
`FaqModal`. O CTA primário usa o gradiente de marca. A faixa usa
`bg-brand-600/10` com borda `border-brand-600/30`, texto pequeno, uma linha só,
truncando com elegância em telas estreitas.

## A animação do passo a passo (iOS)

Componente puro de CSS/React, sem biblioteca. Loop de aproximadamente 12
segundos, dentro de um mockup de iPhone desenhado em CSS:

1. Safari com o ArenaHub aberto; seta pulsando sobre o botão Compartilhar na
   barra inferior.
2. Um "dedo" (círculo translúcido) toca o botão.
3. A folha de compartilhamento sobe.
4. A lista rola até "Adicionar à Tela de Início", que ganha destaque.
5. Toque em "Adicionar" no canto superior direito.
6. Tela de início do iPhone, com o ícone do ArenaHub surgindo com um bounce.

Uma legenda numerada abaixo do mockup fica sincronizada com a cena atual.

Abaixo da animação, **os mesmos quatro passos em texto estático**. Serve a quem
não quer esperar o loop, a quem tem `prefers-reduced-motion` ativo (nesse caso a
animação congela na cena 1 e o texto vira a fonte principal) e a leitores de
tela.

O componente é usado em três lugares sem alteração: dentro do `InstallSheet`, na
página `/instalar` e como fonte da gravação do GIF.

## Geração do GIF

`scripts/gerar-video-instalacao.mjs`:

1. Sobe (ou assume rodando) o dev server e navega para `/instalar?frames=1` —
   um modo em que a animação avança por controle externo em vez de por
   `animation-delay`, garantindo frames determinísticos.
2. Playwright captura N frames PNG do mockup (viewport de celular).
3. `sharp` monta os frames num GIF animado e salva em
   `docs/faq/images/instalar-ios.gif`. Receita **verificada** nesta versão do
   projeto (sharp 0.35):

   ```js
   await sharp(framesPng, { join: { across: 1, animated: true } })
     .gif({ loop: 0, delay: framesPng.map(() => 120) })
     .toFile(destino)
   ```

   O caminho alternativo (buffer raw empilhado com `pageHeight`) **não
   funciona** — libvips reclama de `field "n-pages" not found`. Use `join`.

Não há ffmpeg na máquina de desenvolvimento e não vamos exigi-lo. GIF (em vez de
MP4) é a escolha certa aqui: toca sozinho em qualquer lugar e o WhatsApp o
converte automaticamente ao enviar.

O GIF é um artefato versionado no repositório, regenerado sob demanda — não faz
parte do build.

## FAQ e documentação

Conforme a regra de sincronização da FAQ, toda mudança de UI/fluxo atualiza a
documentação junto:

- Nova seção **"Instale o app no seu celular"** no topo de `docs/faq/aluno.md`,
  antes da seção 1, com o GIF, os passos de iPhone e os de Android.
- Seção equivalente em `docs/faq/academia.md`, já que o admin também vê o popup.
- `docs/faq/capture.mjs` ganha captura dos novos estados → `instalar-sheet-ios.png`,
  `instalar-sheet-android.png`, `instalar-faixa-push.png`, registrados no
  `capture-manifest.json`.
- O link "Ver passo a passo" do sheet aponta para `/ajuda/aluno#instale-o-app-no-seu-celular`
  (âncora gerada por `rehype-slug`).
- A página `/instalar` é pública e serve como link compartilhável para os grupos
  de WhatsApp das academias.

## Testes

`lib/pwa/promptState.test.ts` — a matriz completa de decisão:
desktop; iOS não instalado; iOS in-app browser; iOS instalado com cada uma das
três permissões; Android instalável; Android instalado; Android sem suporte a
push; cada caso de instalação cruzado com `dismissedAt` dentro e fora da janela
de 24h.

`lib/pwa/dismissStorage.test.ts` — grava e lê; janela de 24h nas duas bordas;
valor corrompido; timestamp futuro; localStorage que lança ao escrever.

`components/pwa/` não recebe testes unitários — a verificação dos componentes é
visual, via preview no browser, cobrindo: sheet iOS em viewport de iPhone, sheet
Android, faixa nos dois estados, e o desaparecimento correto após instalar.

Rodar os testes com o tool PowerShell (`npm run test:run`); via Bash a suíte
falha de forma intermitente neste ambiente.

## Divergências da implementação

Quatro coisas que a spec não previu e que a implementação precisou resolver:

1. **`pushConfigured` entrou em `PromptInput`.** Sem `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
   `subscribeToPush` aborta antes de pedir a permissão, então ela nunca sai de
   `default` — e a faixa, que por decisão de produto não fecha, voltaria em toda
   página pedindo algo impossível de conceder. A decisão agora cala a faixa
   quando o app não consegue inscrever ninguém.
2. **O sheet de in-app browser não tem chrome de dispensa.** A spec dizia que o
   estado não é dispensável, mas o componente ainda renderizava `X`, "Agora não"
   e fechar no backdrop — a pessoa tocava e continuava presa atrás do overlay.
3. **z-index subiu de `z-[55]` para `z-[75]`.** O `CookieBanner` é `z-[70]` e
   também ancorado no rodapé: cobria exatamente a fileira de botões do sheet no
   primeiro acesso.
4. **Os textos do passo a passo moraram em `lib/pwa/passosInstalacao.ts`**, e não
   dentro do componente de animação. A página `/instalar` é Server Component e
   não pode iterar constante exportada de módulo `'use client'`.

Além disso, `/instalar` precisou de entrada na allowlist do `middleware.ts`
(estar em `app/(public)/` não basta) e o GIF precisa ser gravado também em
`public/faq/images/`, de onde o manual servido in-app lê as imagens.

## Riscos conhecidos

- **`beforeinstallprompt` perdido na hidratação** — mitigado pelo script inline
  descrito acima. É a falha mais provável de toda a feature: sem o evento, o
  Android cai silenciosamente no caminho de push e ninguém instala nada.
- **In-app browsers** (Instagram, Facebook) — o menu de compartilhar deles não
  tem "Adicionar à Tela de Início". Sem a detecção, o passo a passo mente para o
  usuário. A detecção é por user agent, que é frágil por natureza; erra para o
  lado seguro (na dúvida, mostra o passo a passo normal do Safari).
- **Faixa de push sem botão de fechar** — é a parte mais agressiva do desenho.
  Se der atrito com os usuários, o ajuste é adicionar dispensa por sessão
  (`sessionStorage`), sem mexer em mais nada.
- **Android que já instalou e desinstalou** — o navegador pode não disparar
  `beforeinstallprompt` de novo por um tempo. Cai no caminho de push, que é o
  comportamento aceitável.
