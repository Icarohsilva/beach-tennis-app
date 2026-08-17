# Liga: fechamento que fala, temporada que deixa rastro, cadastro que se explica

Data: 2026-08-17
Estado: design

Três buracos encontrados numa auditoria da Liga já em produção. Nenhum é funcionalidade
nova — os três são lugares onde o sistema **sabe** de algo e não conta para quem interessa.

## 1. O fechamento da temporada é mudo

Hoje `closeLigaSeason` move as divisões, apura os prêmios e vira a temporada. O único
aluno notificado é quem ganhou prêmio (`features/liga/prizes.ts`). Quem subiu de Bronze
para Prata, quem caiu, e quem terminou em 1º sem prêmio configurado descobrem sozinhos —
se abrirem o app depois do dia 1º e repararem que a divisão mudou.

É o momento de maior carga emocional do sistema inteiro, e ele passa em silêncio.

### Regra

Pura em `lib/liga/seasonCloseNotice.ts`, mesmo par do `seasonAlert.ts`: uma função decide
**o quê**, outra escreve o texto. O `seasonClose` só lê standings e despacha.

```ts
export type SeasonOutcome = 'campeao' | 'campeao_subiu' | 'subiu' | 'caiu'

export interface SeasonCloseInput {
  /** 1º colocado da divisão, com pontos > 0. */
  champion: boolean
  moved: 'up' | 'down' | null
  points: number
}

export function seasonCloseOutcome(input: SeasonCloseInput): SeasonOutcome | null
export function seasonCloseText(
  outcome: SeasonOutcome,
  params: { sportLabel: string; fromLabel: string; toLabel: string | null },
): { title: string; body: string }
```

Decisões:

- **Zero ponto não recebe nada.** Quem não apareceu na temporada não precisa saber que
  caiu de divisão; o aviso seria cobrança, e cobrança por push termina em notificação
  desativada. Mesma régua do `seasonAlertKind`.
- **Campeão é o 1º da divisão**, não o 1º da academia. É a disputa que ele realmente
  jogou. Quem é campeão E subiu recebe UMA mensagem que diz as duas coisas — duas
  notificações seguidas sobre o mesmo fato leem como bug.
- **Rebaixamento é convite, não punição.** "Você caiu para o Bronze" fecha o assunto;
  "a temporada nova já começou e dá para voltar" abre. O texto tem que empurrar para a
  quadra, que é o objetivo do mecanismo inteiro.
- **Um push por aluno**, mesmo que ele tenha se movido em dois esportes — mesma escolha
  já feita em `sendSeasonEndAlerts`. Prioridade: campeão que subiu > campeão > subiu >
  caiu. Duas boas notícias no mesmo minuto disputam atenção uma com a outra.

Idempotência não precisa de dedupe próprio: `closeLigaSeason` já retorna cedo quando a
temporada do mês corrente existe, então o corpo roda uma vez por academia por mês.

## 2. Temporada fechada não deixa rastro

Quando vira o mês o ranking anterior some da tela. Não existe "campeões de agosto", nem
onde o aluno já chegou. A medalha é o único vestígio permanente e ela não guarda posição
nem divisão.

**Não precisa de tabela nova.** `liga_standings` é escopado por `season_id` e o
fechamento **não apaga** as linhas da temporada que fechou — ele cria linhas novas para a
temporada nova. O histórico já está gravado; falta só uma tela.

### Leitura

`getSeasonHistory(orgId, studentId, sport, limit)` em `features/liga/queries.ts`, sobre as
temporadas com `status = 'closed'`, da mais recente para a mais antiga. Por temporada:

- a linha do aluno (divisão, posição dentro da divisão, pontos);
- o **campeão da temporada** naquele esporte.

Campeão da temporada = 1º colocado da **divisão mais alta que teve alguém com ponto**. Não
é o maior número de pontos da academia: o Bronze costuma ter mais gente e mais volume, e
premiar volume em vez de patamar inverteria o sentido da escada.

Temporada em que o aluno não pontuou aparece assim mesmo, com o campeão — é memória da
academia, não só do aluno.

### Onde aparece

- **Aluno**: bloco "Temporadas anteriores" na aba Liga, abaixo do ranking. Some quando não
  há temporada fechada (academia no primeiro mês não precisa ver um card vazio).
- **Admin**: seção "Campeões" em `/admin/liga`, uma linha por temporada × esporte.

## 3. O aluno não sabe o que falta no cadastro

O bônus de cadastro completo é a única fonte de ponto que depende de o aluno preencher
algo, e é a única sem retorno: ele preenche, não ganha, e não tem como descobrir por quê.
Aconteceu de verdade — faltava o telefone de emergência, e nada na tela dizia isso.

### Regra

A régua do "completo" mora hoje dentro de `checkProfileComplete`
(`features/liga/extraPoints.ts`), misturada com as leituras do banco. Extrair para
`lib/liga/profileComplete.ts`:

```ts
export interface ProfileFieldsInput {
  phone: string | null
  emergencyName: string | null
  emergencyPhone: string | null
  declaredSports: string[]
  /** Quantas modalidades a academia oferece. Uma só = não há o que escolher. */
  orgSportsCount: number
}

export function missingProfileFields(input: ProfileFieldsInput): string[]
export function isProfileComplete(input: ProfileFieldsInput): boolean
```

`checkProfileComplete` passa a chamar `isProfileComplete`. É o ponto todo da extração: a
tela que diz o que falta e o motor que concede o ponto **não podem** divergir, e duas
cópias da regra divergem no primeiro ajuste.

### Onde aparece

Card no Perfil do aluno, com os campos que faltam nomeados e o valor do bônus. Só aparece
quando as quatro condições valem: Liga ligada, peso da fonte > 0, o aluno ainda não ganhou
o bônus, e falta pelo menos um campo. Fora disso é ruído numa tela que já é longa.

Não é banner de topo nem modal: o aluno chega no Perfil para resolver alguma coisa, e o
card fica ao lado dos formulários que preenchem exatamente esses campos.

## O que este documento NÃO propõe

- Notificar cada ultrapassagem de posição — a spec original já descartou, e continua
  descartado.
- Tabela de histórico. Enquanto `liga_standings` guardar as temporadas fechadas, uma
  tabela nova seria cópia com risco de divergir.
- Bloquear qualquer coisa por cadastro incompleto. O bônus é incentivo; virar exigência
  transformaria uma fonte de ponto em porta trancada.
