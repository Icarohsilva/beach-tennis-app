# Landing Page — Redesign Glassmorphism + Chat WhatsApp + Instagram

**Data:** 2026-06-22
**Status:** Implementado
**Arquivos:** `app/page.tsx`, `app/landing.module.css`, `app/_landing/WhatsAppChat.tsx`, `app/_landing/whatsapp-chat.module.css`

## Objetivo

Substituir a landing pública atual por uma versão visualmente mais impactante e
focada em conversão de cadastro, mantendo a marca laranja e a estrutura técnica
existente (Next.js App Router + CSS Modules).

## Direção visual

**Glassmorphism Premium** — escolhida pelo dono em brainstorming visual:

- Fundo escuro (`#04060d`) com gradient mesh aurora (laranja + rosa + índigo)
- Cards translúcidos com `backdrop-filter: blur(20px)` e bordas suaves
- Tipografia Sora (display, peso 800, letter-spacing negativo) + Inter (corpo)
- Destaques de texto em gradiente laranja→rosa (`.hl`)
- Microanimações sutis (bob nos emojis flutuantes, pulse no eyebrow, hover lift nos cards)

## Estrutura

Nova ordem de seções e nova copy focada em dor → solução → prova → preço → ação:

1. **Nav** — sticky em vidro fosco. Ícone Instagram + Entrar + "Criar grátis →".
2. **Hero** — eyebrow com pulse, headline "O fim do caderninho e do grupo de WhatsApp lotado", phone mockup do app à direita com 3 floaters de esporte (🎾🏆🏐), 3 selos de "1º mês grátis · sem cartão · pronto em 5min".
3. **Sports proof bar** — chips em vidro listando esportes suportados.
4. **Problema** — 3 cards "Você reconhece isso?" (mensagens, caderno, inadimplência).
5. **Features** — 6 cards glass com hover gradient-border e ícones em quadrado laranja translúcido.
6. **Como funciona** — 3 passos numerados (Cria · Convida · Foca em jogar).
7. **Para alunos** — split com foto à esquerda, stats flutuantes ("+200 arenas", "⭐ 4.9"), e copy à direita com 4 pins de benefício.
8. **Pricing** — card destacado com badge "🎁 1º mês grátis", preço R$ 49,90/mês, 6 chips de features inclusas.
9. **FAQ** — 4 perguntas em `<details>` (instalação, cancelamento, esportes, Wellhub/TotalPass).
10. **Final CTA** — "Sua arena lotada começa hoje" com botão "Falar com a gente" que abre o WhatsApp direto.
11. **Footer** — logo + copyright + ícones Instagram (gradient hover) e WhatsApp (verde hover).

## Componentes novos

### `app/_landing/WhatsAppChat.tsx` (client component)

Widget de chat flutuante (FAB) no canto inferior direito.

- **Fechado:** botão circular 60px verde gradiente (`#25D366 → #128C7E`) com
  pulse ring animado.
- **Teaser:** balão branco "💬 Bate um papo com a gente" aparece após 3.5s,
  dismissível.
- **Aberto:** painel 340px com header verde (avatar "AH", "Geralmente responde
  em minutos", status dot), bolha de saudação, textarea pré-preenchida
  ("Olá! Vim pelo site do ArenaHub e queria saber mais.") com 500 chars max, e
  botão "Enviar pelo WhatsApp" que faz `window.open` para
  `https://wa.me/5531996313913?text=<encoded>`.
- Auto-focus no textarea quando abre. Mobile-responsive (full-width acima de
  480px).

### Dados configurados

- Telefone WhatsApp: `5531996313913` (Ícaro)
- Instagram (provisório, será trocado pelo perfil da loja):
  `https://www.instagram.com/icarohsilva/`

Ambos hardcoded como constantes no componente — quando o user trocar pelo
perfil oficial, basta editar `INSTAGRAM_URL` em `app/page.tsx` e a constante
`PHONE` em `app/_landing/WhatsAppChat.tsx`.

## Decisões técnicas

- **CSS Modules** mantido (consistente com o resto do projeto). Não introduzimos
  Tailwind nem libs novas de animação — toda animação é CSS keyframes.
- **Sem Framer Motion / Lottie / GSAP** — landing precisa ser leve e estática.
  Animações são todas CSS (`@keyframes pulse`, `bob1/bob2`, `pulseRing`,
  `teaserIn`, `panelIn`).
- **Ícones inline SVG** (Instagram, WhatsApp) ao invés de importar lucide pra
  evitar bundle extra na rota estática. WhatsApp tem o glyph oficial em path.
- **Pasta `app/_landing/`** segue a convenção Next.js de pastas privadas (prefixo
  `_` não vira rota).
- **FAQ usa `<details>/<summary>`** nativo — sem JS, sem state, animação por CSS.
- Landing continua pré-renderizada estática (`○ /` no build).

## Verificação

- `npm run build` passou (0 errors nos arquivos novos).
- `npm run lint` passou sem warnings novos.
- Os erros TS em `types/index.test.ts` são pré-existentes e não relacionados
  a esta mudança.
