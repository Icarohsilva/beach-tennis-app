# Landing ArenaHub — Overhaul de Conversão

**Data:** 2026-07-02
**Arquivo principal:** [app/page.tsx](../../../app/page.tsx) · [app/landing.module.css](../../../app/landing.module.css)
**Objetivo:** Elevar a landing de "SaaS bem-feito" para "produto de outro mundo" que faz o dono de arena querer criar conta. Foco em prova social, produto vivo e reforço de conversão — sem inventar dados.

---

## Princípios (constraints inegociáveis)

1. **Nenhuma prova social falsa vai ao ar.** Depoimentos são criados como *template* com atribuição em placeholder (`[Nome]`, `[Arena]`, `[Cidade]`), prontos para o dono trocar por clientes reais. Números não verificáveis ("+200 arenas", "⭐4.9") são removidos/suavizados.
2. **Seguir o design system existente.** Reusar tokens do CSS module (`--brand`, `--card`, `--border`, `.hl`, `.btn`, `.glass`, `.khead`, `.blk`). Nada de cores/estilos novos fora da paleta.
3. **Mobile-first.** A maioria do público entra pelo celular; toda mudança é validada em 390px e 1440px.
4. **Acessibilidade e performance.** Animações respeitam `prefers-reduced-motion`. Componentes client só onde há interação/animação.

---

## Escopo

### Bloco A — Prova social e confiança
- **A1. Nova seção "Depoimentos".** 3 cards (avatar com iniciais, aspas, atribuição placeholder). Copy de exemplo escrita, marcada claramente como placeholder no código (comentário `{/* PLACEHOLDER: trocar por depoimento real */}`). Posição: após "Como funciona", antes de "Para alunos".
- **A2. Suavizar números falsos.** Na seção "Para alunos" (`.floatingStat`), trocar `+200 Arenas na rede` e `⭐4.9 Avaliação média` por *value props verdadeiros e não numéricos-inventados*: ex. `Grátis 1º mês` e `5 min Pra configurar`. Mantém o componente visual, elimina a métrica fabricada.

### Bloco B — Produto vivo / fator "uau"
- **B1. Demo interativo animado (nova seção "Veja a arena rodando").** Componente client (`app/_landing/LiveDemo.tsx`) com um device/painel que **auto-reproduz um loop de 4 passos**:
  1. Dono cria uma turma (painel do dono — grade).
  2. Aluno agenda pelo celular (tela do aluno).
  3. Check-in Wellhub registra presença.
  4. Painel financeiro atualiza "quanto entra".
  - Autoplay ao entrar na viewport (IntersectionObserver); pausa fora da tela; respeita `prefers-reduced-motion` (mostra estado final estático). Indicadores de passo (dots) clicáveis.
  - Resolve **duas** dores: substitui o "vídeo" falso e mostra o **painel do dono** (hoje só existe tela de aluno).
- **B2. Botão "Ver em 2 minutos"** passa a rolar suavemente até `#demo` (a nova seção). Texto ajustado para "Ver funcionando" (sem prometer duração de vídeo que não existe).
- **B3. Micro-interações.** Utilitário de scroll-reveal (fade/slide-up via IntersectionObserver, componente `Reveal` client leve) aplicado aos headers de seção e grids. **Sem count-up** — como os números fabricados são removidos (A2), não há métrica real a animar; count-up em preço/tempo seria gimmick. O "uau" vem do reveal + demo animado.

### Bloco C — Conversão
- **C1. Corrigir vão vazio** na seção "Você reconhece isso?" (`.problemGrid` / `.blkFade`) — investigar origem do espaço (provável `min-height`/margin) e ajustar.
- **C2. Âncora de preço.** Abaixo do `R$ 49,90`, linha discreta: "menos que uma aula avulsa · ~R$ 1,66/dia".
- **C3. Reversão de risco** perto do preço: selo/linha "1º mês grátis · sem cartão · cancela em 1 clique".
- **C4. Sticky CTA mobile.** Barra fixa no rodapé (só `@media(max-width: 720px)`), aparece após o usuário rolar além do hero, com "Criar conta grátis →". Componente client (`app/_landing/StickyCta.tsx`) com IntersectionObserver observando o hero. Esconde quando o CTA final está visível para não duplicar.

### Bloco D — Copy
- **D1. FAQ** ganha 3 perguntas de objeção de compra:
  - "Preciso migrar os dados do meu caderno?"
  - "Meus alunos vão conseguir usar sozinhos?"
  - "Funciona sem internet na quadra?"

### Bloco E — Técnico
- **E1. Corrigir erro do manifest.** Root cause confirmado: [middleware.ts](../../../middleware.ts) redireciona `/manifest.json` → `/login` (307) porque o `matcher` não o exclui. **Decisão:** estender a negative-lookahead do `matcher` (linha 59) para excluir `manifest.json|robots.txt|sitemap.xml|sw.js` além das imagens já listadas — assim o middleware nem roda para esses arquivos públicos. O arquivo `public/manifest.json` em si já é JSON válido (sem BOM).

### Bloco F — Ícones (híbrido)
- **F1.** Adicionar dependência `lucide-react`. Trocar os emojis dos **6 cards de recurso** (`.featIc`) por ícones Lucide consistentes (ex.: `CalendarClock`, `CreditCard`, `BadgeCheck`, `BarChart3`, `Trophy`, `MessageCircle`). Manter emoji no hero, chips de esporte, cards de problema e passos (calor informal do esporte de areia).

---

## Não-escopo (YAGNI)

- Não redesenhar o hero nem trocar a paleta/tipografia.
- Não criar CMS/backend para depoimentos — são estáticos no componente.
- Não mexer em rotas autenticadas além do fix pontual do middleware.
- Não adicionar biblioteca de animação pesada (ex.: framer-motion) — CSS + IntersectionObserver bastam.
- Não gravar/produzir vídeo real (o demo animado substitui).

---

## Arquivos afetados / novos

**Novos:**
- `app/_landing/LiveDemo.tsx` + `live-demo.module.css` — demo animado (B1).
- `app/_landing/StickyCta.tsx` + `sticky-cta.module.css` — CTA fixo mobile (C4).
- `app/_landing/Reveal.tsx` — wrapper de scroll-reveal (B3).

**Editados:**
- `app/page.tsx` — nova seção depoimentos (A1), seção demo (B1/B2), números (A2), âncora+risco de preço (C2/C3), FAQ (D1), ícones Lucide (F1), wrappers Reveal (B3), montar StickyCta.
- `app/landing.module.css` — estilos de depoimentos, âncora de preço, ajuste do gap (C1), keyframes de reveal.
- `middleware.ts` — exclusão do manifest (E1).
- `package.json` — `lucide-react` (F1).

---

## Verificação

1. `npm run build` e `npm run lint` sem erros.
2. Dev server: validar visualmente em **1440px** e **390px** — hero, nova seção de demo (autoplay roda), depoimentos, preço com âncora, FAQ novo, sticky CTA aparece/some corretamente.
3. `curl -I https://<preview>/manifest.json` deve retornar `200` com `application/json` (não mais 307 → /login). Localmente, checar que a rota não é interceptada.
4. Console do navegador sem novos erros; erro do manifest sumido.
5. `prefers-reduced-motion: reduce` — animações desligadas, conteúdo final visível.
6. Nenhum nome/arena/número inventado visível como dado real (só placeholders explícitos).

---

## Riscos e mitigações

- **Demo animado pesado no mobile.** Mitigar: animação puramente CSS (transform/opacity), pausa fora da viewport, estado estático em reduced-motion.
- **Placeholder de depoimento indo ao ar sem troca.** Mitigar: texto do placeholder é obviamente ilustrativo ("Exemplo — troque por um cliente real") e documentado; avisar o usuário antes do deploy.
- **Sticky CTA irritante.** Mitigar: só mobile, só após o hero, some no CTA final, com espaçamento pra não cobrir conteúdo.
