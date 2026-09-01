# Narração do vídeo de demonstração

## Por que o roteiro é assim

As duas gravações passam **o app inteiro em avanço rápido** — 10× no aluno, 20× no
painel. Nenhuma tela fica no ar tempo suficiente para ser lida, então narração que
descreve o que está acontecendo ("agora ele toca em reservar") sai do lugar no
primeiro segundo e faz o vídeo parecer quebrado.

O texto abaixo faz o contrário: **narra o valor, não a tela**. A imagem correndo
vira prova de tamanho — "olha quanta coisa existe aqui" — e a voz dá o fio. Isso
também deixa o roteiro imune a recorte: mudar a `velocidade` ou os cortes não
invalida uma frase sequer, só desloca o `em` das faixas.

## Os tempos

Para o corte padrão (aluno 5 min a 10×, admin 20 min a 20×), o vídeo tem **1:45**:

| Bloco | Entra | Sai | Duração |
|---|---|---|---|
| Abertura | 0:00 | 0:06.5 | 6,5 s |
| Capítulo 01 | 0:05.9 | 0:08.9 | 3,0 s |
| Clipe do aluno | 0:08.3 | 0:38.3 | 30 s |
| Capítulo 02 | 0:37.7 | 0:40.7 | 3,0 s |
| Clipe do painel | 0:40.1 | 1:40.1 | 60 s |
| Encerramento | 1:39.5 | 1:45.0 | 5,5 s |

Se você mudar velocidade ou cortes, esses números mudam. O Studio (`npm run studio`)
mostra a linha do tempo real — é ela que manda, não esta tabela.

---

## O texto

Quatro faixas, uma por bloco. Gravar em pedaços é melhor do que de uma vez só:
errar uma frase custa 15 segundos de regravação, não o vídeo inteiro.

### Faixa 01 — `narracao-01-abertura.mp3` · entra em **1,5 s** · alvo ~7 s

> Toda arena vive os mesmos dois problemas: o caderninho da chamada e o grupo de
> WhatsApp lotado.

### Faixa 02 — `narracao-02-aluno.mp3` · entra em **8,5 s** · alvo ~28 s

> Começa pelo seu aluno. Ele abre o app, vê as aulas da semana e reserva a dele em
> dois toques — sem te mandar mensagem, a qualquer hora do dia.
>
> Precisou desmarcar? Avisando dentro do prazo que você definiu, o crédito volta
> pra conta dele na hora.
>
> E a vaga não fica vazia: quem estava na fila de espera é chamado automaticamente.

### Faixa 03 — `narracao-03-arena.mp3` · entra em **40,5 s** · alvo ~55 s

> Agora o seu lado.
>
> A grade da semana sai num clique, com as turmas e os alunos fixos já dentro.
>
> A chamada é no celular, na beira da quadra. Ou nem isso: o aluno confirma a
> presença sozinho, e o app confere que ele está mesmo na sua arena.
>
> Mensalidade, crédito e inadimplência ficam na mesma tela. Você para de cobrar no
> escuro e de manter planilha paralela.
>
> Tem torneio, tem mural de avisos, e tem uma liga com ranking e medalhas — que é o
> que faz o aluno voltar toda semana.
>
> Tudo isso que está passando rápido aqui não é maquete. É o sistema rodando.

### Faixa 04 — `narracao-04-fecho.mp3` · entra em **99,5 s** · alvo ~5 s

> ArenaHub. Primeiro mês grátis, sem cartão. No ar em cinco minutos.

---

## Como gravar

O texto todo dá ~215 palavras. Em ritmo de conversa (não de locutor de rádio) isso
cai em torno de 95 segundos, dentro dos 105 disponíveis — a folga é de propósito:
**silêncio entre as frases é o que deixa o vídeo respirar** quando a imagem já está
correndo.

- **A sua voz vale mais que voz sintética** neste vídeo. É primeiro contato: o
  cliente está comprando de você, não de uma plataforma. Sotaque e hesitação leve
  ajudam; locução perfeita soa a anúncio.
- Grave pelo celular, com o fone de ouvido do próprio celular, num cômodo com
  cortina ou sofá (pano mata eco). Fone é melhor que o microfone do aparelho
  porque fica perto da boca e pega menos sala.
- Grave cada faixa 2 ou 3 vezes seguidas e fique com a melhor. Sai mais rápido do
  que tentar acertar de primeira.
- Corte o silêncio das pontas e exporte em MP3. Se quiser tratar, o Audacity tem
  "Normalizar" e "Redução de ruído" e é grátis.
- Se preferir voz sintética, ElevenLabs e o Azure Speech têm vozes pt-BR
  convincentes. Peça ritmo de conversa, não de propaganda.

## Como colocar no vídeo

1. Salve os arquivos em `public/audio/` (na raiz do repositório, ao lado de
   `public/videos/`).
2. Descomente as faixas em [`src/config.ts`](src/config.ts):

```ts
export const NARRACAO: Faixa[] = [
  { arquivo: 'narracao-01-abertura.mp3', em: 1.5, volume: 1 },
  { arquivo: 'narracao-02-aluno.mp3', em: 8.5, volume: 1 },
  { arquivo: 'narracao-03-arena.mp3', em: 40.5, volume: 1 },
  { arquivo: 'narracao-04-fecho.mp3', em: 99.5, volume: 1 },
]
```

3. `npm run studio` e ouça. Se uma faixa entrar cedo ou tarde, ajuste o `em` — é
   segundo do vídeo final, aceita decimal.
4. `npm run render`.

### Música de fundo

É a mesma lista, com volume baixo e `em: 0`:

```ts
{ arquivo: 'trilha.mp3', em: 0, volume: 0.1 },
```

Acima de ~0,15 a trilha começa a disputar com a voz. E use música licenciada para
uso comercial — o vídeo vai para cliente, e reclamação de direito autoral em
material de venda é um problema caro por um ganho pequeno.

### Um aviso sobre os recortes

`render:aluno` e `render:arena` saem **sem narração**, de propósito: os tempos das
faixas são medidos no vídeo completo, então num recorte elas cairiam no lugar
errado. Para narrar um recorte, grave faixas próprias para ele.
