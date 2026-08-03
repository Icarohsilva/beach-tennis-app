# Confirmação de presença pelo aluno (com geolocalização)

**Data:** 2026-08-03
**Status:** implementado

## 1. Problema

A presença só nascia de duas fontes, ambas fora da mão do aluno:

1. **Professor** marca na chamada → `attendance` com `source='manual'`.
2. **Webhook do parceiro** (Wellhub) casa o check-in com a sessão → `attendance`
   com `source='wellhub'` (`lib/checkin/ingest.ts`).

Quem não é de parceiro depende do professor lembrar de marcar. O relatório de
frequência contorna isso presumindo presença para todos os previstos
(`lib/utils/attendanceReport.ts`) — ou seja, a academia não tem registro real de
quem apareceu.

## 2. Solução

Uma terceira fonte: o próprio aluno confirma pelo app, numa janela em torno da
aula, e o app confere o GPS do celular contra o ponto da academia.

- **Dentro do raio** → presença vale na hora (`attendance` com `source='self'`).
- **Fora do raio, sem GPS ou GPS ruim** → confirmação fica **pendente**; vira
  presença só quando o professor aprovar na chamada.
- **Aluno de parceiro** → o check-in da catraca continua valendo. O botão do app
  some quando já existe `checkins` naquela data, e aparece como plano B quando o
  webhook não chegou.

Nunca bloqueia. Barrar quem negou o GPS geraria mais atrito (GPS urbano falha,
iOS nega permissão por padrão) do que fraude evitada.

## 3. Janela

Abre **1h antes do início** e fecha **1h depois do fim** da aula. Aula das
19:00–20:00 → das 18:00 às 21:00. O extremo depois do fim é deliberado: cobre o
aluno que só lembra de confirmar quando a aula acaba.

Constantes em `lib/checkin/selfCheckin.ts`. Os instantes são ancorados em BRT via
`sessionStartIso` (`lib/utils/sessionTime.ts`) — o mesmo helper que casa o
webhook do parceiro.

A janela é avaliada **duas vezes**: no cliente, para decidir o que renderizar
(o servidor roda em UTC e mostraria "abre às 21h"); e no servidor, na action,
como autorização de verdade.

## 4. Matriz de status

`resolveSelfCheckinStatus` em `lib/checkin/selfCheckin.ts`:

| Situação | Status | `geo_error` |
|---|---|---|
| Academia sem lat/lng | `pending` | `org_unset` |
| Aluno negou / GPS indisponível / timeout / sem suporte | `pending` | `denied` · `unavailable` · `timeout` · `unsupported` |
| `accuracy > 1500 m` | `pending` | `inaccurate` |
| `distância ≤ raio + min(accuracy, 100 m)` | `validated` | — |
| Resto | `pending` | `out_of_range` |

A folga de `min(accuracy, 100 m)` existe porque um aluno em cima da quadra com
leitura de ±80 m cairia como pendente. O teto de 100 m impede que uma precisão
ruim vire raio infinito.

Distância por haversine — precisão de sobra na escala de uma quadra.

## 5. Modelo de dados

### `organizations` (migração `20260803000100`)

`latitude`, `longitude`, `checkin_radius_m` (padrão 150, entre 20 e 5000) e
`self_checkin_enabled` (padrão `false`).

Nasce desligado de propósito: sem ponto marcado, toda confirmação cairia como
pendente e viraria fila de trabalho para o professor. A action de configuração
recusa habilitar sem coordenadas.

Lat/lng em `organizations` já estava previsto — `2026-06-18-aula-experimental-por-regiao-design.md`
adiou "lat/lng + raio" com a nota de que o schema evoluiria depois.

O ViaCEP (`lib/arenas/cep.ts`), única fonte geográfica já integrada, **não**
devolve coordenadas. O caminho é o dono abrir `/admin/configuracoes` na quadra e
capturar a própria posição.

### `self_checkins` (tabela nova)

Tabela própria, e não colunas em `attendance`, pela mesma razão que separou
`checkins` de `attendance`: ciclo de vida diferente. `attendance` é o veredito;
`self_checkins` é a evidência, com estado de revisão, e nunca é sobrescrita
quando o professor ajusta a chamada.

```
id · organization_id · student_id · session_id
status         validated | pending | rejected
latitude · longitude · accuracy_m · distance_m · geo_error
reviewed_by · reviewed_at · created_at
unique (student_id, session_id)
```

RLS só de leitura (aluno vê o próprio; admin vê os da academia). Escrita passa
por `createAdminClient()`, como `missed_checkins` e `pending_checkins`.

### `attendance_source`

Ganha `'self'` (migração `20260803000000`, isolada — `ALTER TYPE ... ADD VALUE`
não permite usar o valor novo na mesma transação).

## 6. Fluxo da action

`confirmSelfAttendance` (`features/checkin/selfCheckinActions.ts`). Nada vindo do
cliente é confiado como autorização:

1. Autenticação + academia ativa.
2. Recurso habilitado na academia.
3. Sessão existe, org-scoped, `status='scheduled'`. Depois do "encerrar aula" a
   lista está fechada — o professor já deu a palavra final.
4. **Elegibilidade**: `isStudentExpectedInSession` (`features/aulas/sessionUtils.ts`),
   mesma regra da chamada e da agenda, enunciada em `mergeSessionAttendees`.
5. **Janela**, pelo relógio do servidor.
6. **Curto-circuito de parceiro**: `checkins` na data → não duplica.
7. Veredito + upsert em `self_checkins`. Uma nova tentativa pode **subir** de
   pendente para validada (o aluno chegou na quadra e tentou de novo), mas nunca
   rebaixa uma validada nem reabre uma recusada.
8. Validada → upsert em `attendance` com `ignoreDuplicates: true` (espelha
   `recordResolvedCheckin`: a confirmação do aluno jamais sobrescreve o que o
   professor marcou), depois `ensureClassDebt` best-effort. Pendente → só a
   evidência, sem `attendance`.

`reviewSelfCheckin(id, approve)` é a decisão do professor: aprovar aplica a mesma
presença do passo 8; recusar só arquiva, sem mexer em `attendance` — o professor
segue livre para marcar presente ou faltou na chamada.

## 7. UI

**Aluno** — `features/checkin/SelfCheckinPanel.tsx`, em dois lugares:

- Card na primeira dobra da `/home` (`features/home/SelfCheckinCard.tsx`), só
  quando alguma aula do aluno está com a janela aberta. Adoção depende de
  visibilidade: ele abre o app na quadra.
- Dentro da ficha da aula (`features/home/SessionModal.tsx`).

O componente pede a posição no clique (o prompt do browser exige gesto do
usuário) e chama a action **nos dois caminhos** — erro de GPS não impede
confirmar. Feedback inline, no padrão do repositório (não há toast).

**Professor** — `features/aulas/AttendanceSheet.tsx`:

- `validated` → selo verde "confirmou no app · 45 m"; o aluno já vem marcado
  presente porque a `attendance` existe.
- `pending` → aviso âmbar com o motivo (`selfCheckinGeoErrorLabel`) e os botões
  **Aprovar** / **Recusar**.
- Contador no topo avisando quantas confirmações aguardam validação — o
  `markAttendanceBulk` do "encerrar aula" marca ausente quem não tem presença, e
  pendente não tem.

**Dono** — `app/(admin)/admin/configuracoes/SelfCheckinForm.tsx`: liga/desliga,
"usar minha localização atual", lat/lng manuais e raio.

## 8. O que o geofence NÃO garante

As coordenadas vêm do browser e **podem ser forjadas** (DevTools, apps de fake
GPS). O geofence eleva o custo da fraude; não a elimina. Por isso:

- o professor continua sendo a autoridade final e nada aqui remove a chamada;
- a confirmação do aluno nunca sobrescreve uma marcação do professor;
- pendente não vira presença sozinha.

## 9. Fora de escopo

- Push avisando que a janela abriu.
- Geocoding automático a partir do CEP.
- Coordenada por quadra/turma (uma organização = uma academia física).
- Confirmação para Day Use e torneios.
