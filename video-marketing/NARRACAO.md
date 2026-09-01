# Roteiros, narração e mensagens

## São dois vídeos, não um

| | **Convite** | **Apresentação** |
|---|---|---|
| Quando | Junto do primeiro "oi" | Depois que a arena responde |
| Duração | 35 s | 1:57 |
| Formato | Vertical 1080×1920 | Horizontal 1920×1080 |
| Comando | `npm run render:convite` | `npm run render` |
| O que pede | Permissão para mostrar | A conversa |

A divisão é por **etapa da conversa**, não por público (aluno / arena). Dividir por
público daria dois vídeos frios pela metade, cada um contando só um lado; dividir por
etapa dá dois vídeos inteiros, cada um com uma tarefa que ele consegue cumprir.

O motivo é de dado, não de gosto. Em prospecção fria a taxa de conclusão desaba acima
de 90 s, ~30% abandonam nos primeiros 30 s, e o espectador decide em torno de 5 s se
continua. Um vídeo de quase dois minutos é excelente como **segundo** toque e ruim como
primeiro — não porque seja ruim, mas porque ninguém pediu para vê-lo ainda.

## Três decisões que o roteiro carrega

**A dor vem antes da marca.** Os primeiros 10 s dos dois vídeos são as frases de
`DORES` (em `src/config.ts`), em texto grande, sem logo. A marca só aparece quando a
bola bate e varre as frases. Logo animado não é motivo para continuar assistindo;
reconhecer o próprio domingo à noite é.

**A arena vem antes do aluno.** Quem decide a compra é o dono. Começando pelo aluno,
ele passa a janela de maior abandono vendo tela de alguém que ainda não é problema
dele. A experiência do aluno vira o desfecho — é o que ele vai querer mostrar para os
alunos, então é o melhor gancho logo antes da chamada final.

**A narração não descreve a tela.** As gravações passam a 10× e 20×; narração
descritiva ("agora ele toca em reservar") sai do lugar no primeiro segundo. O texto
abaixo narra o valor, e por isso continua válido se você mudar cortes ou velocidade —
só os tempos de entrada mudam. As **paradas** (a imagem congelando com um rótulo) são
o que dá ao espectador algo legível para olhar enquanto você fala.

---

# CONVITE — 35 s

| Bloco | Entra | Sai |
|---|---|---|
| Dores + marca | 0:00 | 0:10.0 |
| A arena | 0:09.4 | 0:19.9 |
| O aluno | 0:19.3 | 0:28.8 |
| Chamada | 0:28.2 | 0:35.2 |

### `convite-01.mp3` · entra em **0,8 s** · alvo ~8 s

> Domingo, dez da noite, e três alunos te chamando pra remarcar aula. Você virou
> secretária da própria arena.

### `convite-02.mp3` · entra em **10 s** · alvo ~9 s

> Isso aqui é o ArenaHub. A sua semana inteira montada num clique, e a inadimplência
> na tela — sem planilha.

### `convite-03.mp3` · entra em **20 s** · alvo ~8 s

> E o seu aluno reserva, cancela e entra na fila sozinho. Sem passar por você.

### `convite-04.mp3` · entra em **28,8 s** · alvo ~6 s

> Se quiser ver por dentro, me responde qualquer coisa que eu te mando o completo.

**~72 palavras.** Repare que a narração não repete o texto da tela — ela acrescenta o
"virou secretária da própria arena", que é a frase que o texto não diz.

---

# APRESENTAÇÃO — 1:57

| Bloco | Entra | Sai |
|---|---|---|
| Dores + marca | 0:00 | 0:10.0 |
| Capítulo 01 | 0:09.4 | 0:12.4 |
| A sua operação | 0:11.8 | 1:16.8 |
| Capítulo 02 | 1:16.2 | 1:19.2 |
| O que o aluno vê | 1:18.6 | 1:52.4 |
| Encerramento | 1:51.8 | 1:57.3 |

### `narracao-01-dores.mp3` · entra em **0,6 s** · alvo ~9 s

> Domingo à noite, três alunos te chamando pra remarcar. Segunda, você ainda não sabe
> quem faltou nem quem pagou.

### `narracao-02-arena.mp3` · entra em **13 s** · alvo ~55 s

> Vamos começar pelo seu lado.
>
> A grade da semana sai num clique — todas as turmas, todos os horários, com os alunos
> fixos já dentro.
>
> A chamada é no celular, na beira da quadra. Ou nem isso: o aluno confirma a presença
> sozinho, e o app confere que ele está mesmo na sua arena.
>
> Mensalidade, crédito e inadimplência ficam na mesma tela. Você para de cobrar no
> escuro e de manter planilha paralela.
>
> Tem torneio, tem mural de avisos, e tem uma liga com ranking e medalhas — que é o que
> faz o aluno voltar toda semana.
>
> O que está passando rápido aqui não é maquete. É o sistema rodando.

### `narracao-03-aluno.mp3` · entra em **82 s** · alvo ~29 s

> Agora o outro lado: o que os seus alunos veem.
>
> Ele abre o app, vê as aulas da semana e reserva em dois toques. A qualquer hora, sem
> te mandar mensagem.
>
> Desmarcou dentro do prazo que você definiu? O crédito volta pra conta dele na hora.
>
> E a vaga não fica vazia: quem estava na fila é chamado automaticamente.

### `narracao-04-fecho.mp3` · entra em **113 s** · alvo ~5 s

> ArenaHub. Primeiro mês grátis, sem cartão. No ar em cinco minutos.

**~210 palavras**, ~95 s falados nos 117 disponíveis. A folga é de propósito: com a
imagem correndo, o silêncio entre as frases é o que deixa o vídeo respirar.

Se a faixa 02 ficar corrida na gravação, corte a frase do torneio/mural — é a menos
essencial das cinco.

---

# As mensagens de WhatsApp

### Primeira, junto do Convite

> Oi, [nome]! Tudo bem? Aqui é o Ícaro.
>
> Eu fiz um sistema de gestão de aulas pra arenas — agenda, chamada, mensalidade e
> crédito no mesmo lugar, e um app pro aluno marcar sozinho.
>
> Gravei 35 segundos mostrando por cima. Se fizer sentido, me responde que eu mando o
> completo. 👇

Manda a mensagem **e** o vídeo. Não peça permissão para mandar o que você já pode
mandar: o convite dura 35 s e pede a permissão sozinho, no fim.

### Segunda, quando responderem

> Show! Esse é o completo, 2 minutos.
>
> Primeiro o seu painel, depois o que o aluno vê.
>
> Se quiser testar antes de decidir qualquer coisa, o primeiro mês é grátis e não pede
> cartão — eu configuro a sua arena junto com você numa call de 15 min.

### Dois detalhes que mudam resultado

**A capa é o primeiro frame.** O WhatsApp mostra o primeiro quadro do vídeo como capa
da mensagem, e é o único que o contato vê garantidamente. Por isso o frame 0 do Convite
já entra com o gancho escrito, em vez de fundo preto. Se você mexer nos tempos da
abertura, confira o frame 0 (`npm run still`) antes de mandar.

**Mande como vídeo, não como documento.** Enviado como documento, o WhatsApp não gera
capa nem toca sozinho — vira um anexo que ninguém abre.

---

# Como gravar

- **A sua voz vale mais que voz sintética.** É primeiro contato: o cliente está
  comprando de você. Sotaque e hesitação leve ajudam; locução perfeita soa a anúncio.
- Grave pelo celular, com o fone de ouvido do próprio celular, num cômodo com cortina
  ou sofá — pano mata eco, e o fone fica perto da boca e pega menos sala.
- Grave cada faixa 2 ou 3 vezes seguidas e fique com a melhor. Sai mais rápido do que
  tentar acertar de primeira.
- Corte o silêncio das pontas e exporte em MP3. O Audacity é grátis e tem "Normalizar"
  e "Redução de ruído".

# Como montar o áudio

1. Salve os arquivos em `public/audio/`.
2. Descomente as faixas em [`src/config.ts`](src/config.ts), em `NARRACAO`.
3. `npm run studio`, ouça, e ajuste o `em` de quem entrar cedo ou tarde.
4. `npm run render` (ou `render:convite`).

### Trilha

Em `TRILHA`, uma faixa com `em: 0` cobrindo o vídeo inteiro:

```ts
export const TRILHA: Faixa[] = [{ arquivo: 'trilha.mp3', em: 0, volume: 0.16 }]
```

O volume ali é o volume **quando ninguém está falando**: enquanto a narração toca, a
trilha abaixa sozinha. As janelas são calculadas medindo os próprios arquivos de
narração, então continuam certas depois de você regravar uma faixa.

Onde procurar música livre para uso comercial — **confira a licença de cada faixa, não
a do site**, porque quase todos misturam faixas grátis e pagas na mesma busca:

- **Pixabay Music** — o mais simples, sem exigência de atribuição
- **Mixkit** — curadoria menor, licença direta
- **Uppbeat** — grátis com atribuição, ou pago sem
- **Biblioteca de Áudio do YouTube** — boa, e indica quando exige crédito

Para este vídeo, procure algo instrumental, ritmo constante, sem vocal e sem virada
dramática: a trilha aqui é chão, não protagonista.

### Efeitos

`npm run gerar:sfx` cria `public/audio/sfx/` com `whoosh`, `impacto`, `clique`, `riser`
e `sub-drop` — sintetizados no próprio projeto, e não baixados, porque material de venda
com áudio de licença duvidosa é um problema caro por um ganho pequeno.

Ative em `EFEITOS`, com o segundo de cada um. Os que valem a pena:

| Efeito | Onde | Volume |
|---|---|---|
| `impacto.wav` | 5,0 s — quando a bola bate e o logo nasce | 0.7 |
| `whoosh.wav` | nas viradas de bloco (9,4 s / 19,3 s no Convite) | 0.45 |
| `clique.wav` | no começo de cada parada | 0.4 |
| `sub-drop.wav` | na entrada da chamada final | 0.5 |

Menos é mais: efeito em toda transição vira ruído e faz o vídeo parecer template. Três
ou quatro no vídeo inteiro é o suficiente.
