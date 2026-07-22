# Relatório de frequência (presenças e faltas)

**Data:** 2026-07-22
**Superfícies:** painel da academia (`/admin/relatorios`) e área do aluno (Home + Perfil).

## O problema

A academia não consegue responder "quem está vindo às aulas?". Hoje a presença
só existe se o professor abrir a sessão, tocar em **Iniciar Aula** e confirmar a
chamada — e isso praticamente não acontece.

Levantamento no banco em 2026-07-22:

| Academia | Aulas passadas | Com chamada confirmada | Linhas de `attendance` |
|---|---|---|---|
| Academia Hudson Barros | 74 | **1** | 6 (todas `wellhub/present`) |
| Teste Academia 2 | 4 | 1 | 1 (`manual/absent`) |

Das 7 linhas de presença do banco inteiro, 6 vieram do webhook do Wellhub e
apenas 1 de chamada manual. **Um relatório construído sobre esse dado nasceria
vazio.** O gargalo não é a tela — é como a presença entra no sistema.

## Decisões tomadas

1. **Presença é presumida, o professor corrige.** Quem era esperado numa aula
   que já passou conta como presente até alguém dizer o contrário. O relatório
   fica útil desde o primeiro dia, sem depender de um hábito que não existe.
2. **Três estados: Presente · Falta · Avisou.** Quem cancela antes da aula conta
   separado de quem simplesmente não aparece — é a diferença que interessa ao
   professor.
3. **Sem histórico inventado.** A presunção vale só a partir da data de ativação.
   As 74 aulas antigas ficam como "sem registro"; nada é afirmado sobre aula que
   ninguém conferiu.

## Arquitetura: calcular na leitura

A presunção **não é gravada**. O relatório deriva o estado na hora da consulta;
`attendance` continua guardando apenas o que alguém afirmou (professor ou
webhook de parceiro).

Alternativa descartada: um cron materializar linhas de presença presumida. Traria
migration nova, cron novo e — pior — gravaria como fato uma suposição. Com
~500 linhas/mês por academia, materializar não se paga.

Consequência boa: **corrigir já funciona hoje.** O professor marca a falta pela
chamada existente, a linha de `attendance` passa a existir e vence a presunção.
Nenhum código novo de escrita.

### A regra de classificação

Para cada par (aluno, sessão) de uma sessão com `session_date` **estritamente
anterior a hoje** (data do servidor), `status != 'cancelled'` e a partir do
corte:

> Aula de hoje não entra no relatório — ela aparece amanhã. Evita depender do
> fuso do servidor (UTC) para decidir se a aula das 20h já terminou, que é
> exatamente o tipo de erro que já mordeu este app.

| Situação | Conta como |
|---|---|
| `attendance.status = 'present'` (ou `'late'`) | **Presente** — confirmado |
| `attendance.status = 'absent'` | **Falta** |
| Era esperado e não há `attendance` | **Presente** — presumido |
| Tem `session_bookings` `cancelled` nessa sessão | **Avisou** |
| Não era esperado | fora da conta |

`'late'` entra como presente: o aluno esteve na aula.

**"Era esperado"** reusa a regra já implementada e testada em
`lib/utils/attendees.ts` (`mergeSessionAttendees`): alunos fixos da turma
**∪** reservas confirmadas (`session_bookings`), **menos** quem tem reserva
`cancelled` naquela sessão. É a mesma definição que a agenda do aluno já usa —
uma regra só, um lugar só.

**Com uma diferença essencial para o relatório: a matrícula é datada.** A agenda
olha o presente e usa `enrollments.is_active`; o relatório olha o passado e
precisa da janela em que a matrícula valia. Um aluno só é fixo numa sessão se:

```
enrolled_at <= session_date  E  (cancelled_at é nulo OU cancelled_at > session_date)
```

Sem isso, quem se matricula hoje ganharia faltas retroativas de semanas em que
nem era aluno da turma — e quem saiu da turma continuaria acumulando faltas.
O filtro por janela acontece **antes** do merge; `mergeSessionAttendees` segue
intocado.

**Aproveitamento = presenças ÷ (presenças + faltas + avisos).**
O aviso entra no denominador: a aula estava prevista para o aluno e ele não foi.

### Corte temporal

Constante `ATTENDANCE_TRACKING_START` (data do deploy da feature). Sessão
anterior a ela não entra em nenhuma conta e é reportada como "sem registro".

Academia criada depois do corte usa a própria data de criação — o corte efetivo é
`max(ATTENDANCE_TRACKING_START, organizations.created_at)`.

Não vira coluna no banco por enquanto: uma constante resolve, e a alternativa
(configurar por academia) só faz sentido quando alguém pedir para começar a
contar noutra data.

## Módulos

| Arquivo | Responsabilidade |
|---|---|
| `lib/utils/attendanceReport.ts` | **Puro, sem I/O.** Recebe sessões, esperados, `attendance` e cancelamentos; devolve o estado por (aluno, sessão) e os totais por aluno. Testável direto. |
| `features/relatorios/query.ts` | Busca no Supabase o período pedido e entrega os dados brutos ao módulo puro. |
| `app/(admin)/admin/relatorios/page.tsx` | Tela do painel. |
| `features/relatorios/FrequencyTable.tsx` | Tabela por aluno, ordenável (client). |
| `features/perfil/MinhaFrequencia.tsx` | Visão do aluno (mês + ano). |

A lógica fica no módulo puro; as telas só desenham. Mesmo padrão de
`lib/utils/agenda.ts` e `lib/utils/attendees.ts`.

## Painel da academia — `/admin/relatorios`

Novo item no menu lateral e no menu mobile. Área nova `'relatorios'` em
`AdminArea`; **não** entra em `OWNER_ONLY` — o professor precisa ver a frequência
das turmas dele.

- **Semana** (padrão) / **Mês**, com navegação para períodos anteriores. A visão
  semanal é o "relatório que vai sendo preenchido" do dia a dia.
- **Faixa de números:** aulas realizadas, presenças, faltas, avisos e % de
  comparecimento da academia no período.
- **Tabela por aluno:** presenças, faltas, avisos, aproveitamento. Ordenação
  padrão por **aproveitamento** — ordenar por presenças absolutas favorece quem
  tem três aulas na semana sobre quem tem uma. Todas as colunas são ordenáveis.
  Aluno com falta não avisada recebe destaque visual **com rótulo textual**, não
  só cor.
- **Aulas sem registro** no período, cada uma com atalho para a chamada. É o
  ponto de correção, e também o que revela aula que nunca aconteceu.

## Área do aluno

- **Home:** card compacto com o mês corrente ("Julho · 7 presenças · 1 falta ·
  70%"), na mesma linguagem visual dos outros cards de vidro.
- **Perfil:** seção "Minha frequência" com o mês (navegável) e o total do ano.

O aluno vê os mesmos três estados. Presença presumida não é rotulada como
"presumida" para ele — para o aluno é presença; a distinção existe para o
professor decidir se corrige.

## Correção de rota junto: o furo da chamada

`app/(admin)/admin/grade/[sessionId]/page.tsx` monta a lista da chamada **apenas
com reservas confirmadas**. Aluno fixo sem reserva gerada (a reconciliação só
reserva quem tem parceiro ou plano vigente) **nunca aparece na chamada** — logo
sua falta nunca é registrada.

Sem corrigir isso, o relatório herda o furo: o aluno some da conta em vez de
aparecer como falta. A chamada passa a usar a mesma regra de "esperado"
(`mergeSessionAttendees`), igual à agenda do aluno.

## Casos de borda

| Caso | Comportamento |
|---|---|
| Sessão `cancelled` (chuva, feriado) | Fora da conta para todos. Não vira falta. |
| Aluno se matricula hoje na turma | Não é esperado em sessões anteriores a `enrolled_at`. Sem faltas retroativas. |
| Aluno sai da turma | Deixa de ser esperado a partir de `cancelled_at`. Não acumula falta depois de sair. |
| Check-in de parceiro sem chamada | Já grava `attendance` `present`; conta como confirmado. |
| Aluno avulso (reposição/extra) | Reserva confirmada = esperado; entra na conta daquela sessão. |
| Professor marca falta e o aluno reclama | A linha de `attendance` é a verdade; o professor reabre a chamada e ajusta. |
| Aula de hoje | Não entra; aparece no relatório a partir de amanhã. |
| Aluno sem nenhuma aula prevista no período | Fica fora da tabela (não aparece com 0/0). |

## Testes

`lib/utils/attendanceReport.test.ts` cobre a regra pura:

- presumido vs confirmado, e `absent` vencendo a presunção;
- aviso fora das presenças mas dentro do denominador;
- sessão `cancelled` ignorada para todos;
- corte temporal (`ATTENDANCE_TRACKING_START`) e aula de hoje fora;
- aluno fixo sem reserva contando como esperado;
- **janela da matrícula**: sem falta antes de `enrolled_at`, sem falta depois de
  `cancelled_at`;
- `late` contando como presente;
- aproveitamento com denominador zero (não divide por zero, aluno fica fora).

## Fora de escopo

Exportar CSV/PDF, notificar aluno faltoso automaticamente, meta de frequência por
aluno, fechamento/congelamento de mês. Todos fazem sentido depois — primeiro o
número precisa existir e ser confiável.

## Verificação

`npm run test:run`, `npm run lint`, `npm run build`, e conferência no navegador
com as contas de teste (academia e aluno). Atualizar `docs/faq/` (manuais +
prints via `capture.mjs`, sincronizando `public/faq/images`).
