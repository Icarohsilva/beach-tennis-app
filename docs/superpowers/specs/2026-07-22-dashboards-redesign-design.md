# Redesign dos dashboards (aluno e admin)

**Data:** 2026-07-22
**Escopo:** primeira tela pós-login dos dois perfis — `/home` (aluno) e `/admin/dashboard` (academia).

## Problema

As duas telas iniciais eram listas de cards chapados. Elas informavam, mas não
respondiam de imediato a pergunta que leva a pessoa a abrir o app:

- **Aluno:** "quando é minha próxima aula e ainda tem vaga?" — era preciso rolar
  até "Minhas Próximas Aulas" e comparar datas na cabeça.
- **Academia:** "como está o dia?" — havia quatro contadores e uma grade de aulas
  sem noção de horário, ocupação ou do que já passou.

Não havia hierarquia visual (tudo com o mesmo peso), nem movimento, nem uma
agenda propriamente dita.

## Direção de design

Um "painel de controle" escuro e técnico, construído sobre os tokens que já
existem — a cor da marca continua vindo de `--brand-*` por academia, então cada
arena recebe o próprio ambiente sem nenhum código específico.

Quatro camadas:

1. **Aurora de fundo** (`AuroraBackground`) — manchas desfocadas na cor da
   academia derivando devagar atrás de tudo. Dá profundidade ao fundo chapado.
2. **Superfícies de vidro** (`.glass`, `Card glass`) — cards translúcidos com
   desfoque sobre a aurora, em vez de um cinza opaco.
3. **Movimento com significado** — entrada em cascata (`Reveal`), números que
   contam de zero (`AnimatedNumber`), barras de ocupação que crescem, e um halo
   pulsante só no que está **vivo agora** (aula em andamento, contagem regressiva).
4. **Hierarquia** — cada tela tem um único elemento dominante: a contagem
   regressiva (aluno) e a linha do tempo do dia (academia).

Tudo é CSS puro — nenhuma dependência nova. `prefers-reduced-motion: reduce`
desliga toda animação e entrega o layout final.

## Aluno — `/home`

| Bloco | O que resolve |
|---|---|
| `HeroHeader` | Saudação pelo período do dia + data + 3 números (créditos/plano, aulas/semana, aulas nesta semana). |
| `NextClassSpotlight` → `NextClassCard` | **Contagem regressiva viva** até a próxima aula, com horário, ocupação e ação. Sem aula marcada, oferece a próxima com vaga. |
| `WeekAgenda` | Faixa dos próximos 7 dias; tocar num dia troca a lista sem ir ao servidor. Hoje traz as ações reais de agendamento. |

**Decisão-chave: o relógio é o do aluno, não o do servidor.** O servidor roda em
UTC; perto da virada do dia ele elegeria como "próxima" uma aula já encerrada e
erraria a saudação. Por isso a escolha do card de destaque, a contagem regressiva
e a saudação acontecem depois da hidratação, partindo de um estado neutro que já
é válido sozinho (evita divergência de HTML).

**Decisão-chave: a agenda não duplica as ações.** O dia de hoje renderiza no
servidor o bloco existente (`ClassCard` + `AgendarClient`, com entrar/fila/sair)
e ele é injetado na `WeekAgenda` via prop `todayContent`. Os outros dias mostram
a versão informativa. Assim a home tem uma agenda só, sem uma segunda cópia sem
botões.

## Academia — `/admin/dashboard`

| Bloco | O que resolve |
|---|---|
| `AdminHero` | Saudação, data e o pulso do dia ("5 aulas hoje · 22 alunos esperados") + atalhos de grade. |
| `StatCard` (4×) | Os mesmos KPIs, agora com ícone e contagem animada. |
| `DayTimeline` | Aulas do dia em linha do tempo com marcador de **agora** que corre com o relógio; aula passada apagada, aula em curso destacada; cada uma leva à chamada. |
| `OccupancyPanel` | Anel com a ocupação do dia + turmas mais cheia e mais vazia — onde ainda dá para encaixar aluno. |
| Ações rápidas | Mesmos destinos, com ícones e respeitando `canAccessArea`. |

## Regras de visualização de dados

Seguindo a skill `dataviz`:

- **Ocupação é grandeza, não estado** → um só matiz (o da marca) em três degraus
  (`brand-800` → `brand-600` → `brand-400`) conforme enche. Nunca arco-íris.
- **A cor nunca carrega sozinha a informação** — toda barra vem com o número
  (`4/8`) ao lado; "Lotada" é um `Badge` com texto.
- **Cores de status ficam reservadas** para estado (Pendente, Lotada, Confirmada)
  e não viram "série 4".
- **Texto usa tokens de texto**, não a cor da série.
- Rótulos secundários subiram de `slate-500` para `slate-400` para passar no
  contraste mínimo em texto pequeno.

## Lógica extraída e testada

`lib/utils/agenda.ts` concentra o que é puro e tem regra de negócio, com testes
em `agenda.test.ts` (17 casos):

- `greetingFor(hour)` — faixas do dia.
- `countdownLabel(start, end, now)` — "Faltam 2h 24min", "Acontecendo agora",
  "Amanhã", "Em 3 dias".
- `buildWeekDays(startISO, days, items)` — janela de N dias com os dias vazios
  preservados; atravessa virada de mês.
- `addDaysISO` — soma dias sem passar pelo fuso do processo.
- `occupancyLevel(booked, capacity)` — degrau do matiz.

Os componentes ficaram sem lógica: só desenham.

## Custo no servidor

A home ganhou 3 consultas (sessões dos 7 dias, presenças confirmadas nelas,
reservas do aluno na janela) e perdeu 1 (as matrículas do aluno passaram a ser
buscadas uma vez só, em vez de filtradas pelas turmas de hoje). O dashboard admin
ganhou 2 (presenças por sessão de hoje, nome da academia).

## O que não mudou

Rotas, permissões (`canAccessArea`), gates do layout admin, regras de
agendamento/crédito, alvos `data-tour` do tour guiado e o schema do banco.

## Verificação

- `npm run test:run` — 174 arquivos, 1070 testes, todos passando.
- `npm run lint` — limpo (permanecem os 4 avisos de `<img>` pré-existentes).
- `npm run build` — compila.
- `node docs/faq/capture.mjs` — 27/27 etapas, prints do FAQ regerados.
- Home do aluno conferida no navegador com dados reais (Academia Hudson Barros);
  dashboard admin conferido no print regerado pelo `capture.mjs`.
