# Vídeos de demonstração do ArenaHub (Remotion)

Monta em código os dois vídeos da prospecção. A edição é código, então trocar um corte,
um texto ou a ordem é editar um arquivo e renderizar de novo — não é refazer a edição
na mão.

| | **Convite** | **Apresentação** |
|---|---|---|
| Quando | Junto do primeiro "oi" no WhatsApp | Depois que a arena responde |
| Duração | ~39 s | ~2 min |
| Formato | Vertical 1080×1920 | Horizontal 1920×1080 |
| Comando | `npm run render:convite` | `npm run render` |

A divisão é por **etapa da conversa**, não por público: em prospecção fria a conclusão
desaba acima de 90 s, então um vídeo de dois minutos é ótimo como segundo toque e ruim
como primeiro. O raciocínio completo e os roteiros estão em [NARRACAO.md](NARRACAO.md).

É um projeto **separado do app Next**: tem o próprio `package.json` e o próprio
`node_modules`. Nada aqui entra no build da Vercel.

## Antes de rodar

Coloque as duas gravações em `public/videos/` **na raiz do repositório** (não dentro
desta pasta):

```
public/videos/admin.mp4   (o painel da arena)
public/videos/aluno.mp4   (o app do aluno)
```

E os prints que o **Convite** mostra dentro do celular, em `public/imagens/`:

```
01-agenda-semana.png   02-chamada.png      03-inadimplencia.png
04-aluno-reserva.png   05-aluno-credito.png  06-liga.png
```

Tudo isso é ignorado pelo git de propósito: são seus arquivos, alguns pesados, e
`public/` é publicado no deploy.

## Rodar

```bash
cd video-marketing
npm install          # só na primeira vez

npm run acelerar     # gera as cópias aceleradas das gravações (uma vez, e a cada mudança de velocidade)
npm run studio       # editor visual em localhost:3000 — veja e ajuste antes de renderizar
npm run render:convite   # gera out/arenahub-convite.mp4
npm run render           # gera out/arenahub-demo.mp4
```

O primeiro render baixa o navegador que o Remotion usa (~110 MB), uma vez só.

| Comando | Sai em | Para quê |
|---|---|---|
| `npm run render:convite` | `out/arenahub-convite.mp4` | O vídeo do primeiro contato |
| `npm run render` | `out/arenahub-demo.mp4` | A apresentação completa |
| `npm run render:arena` | `out/arenahub-arena.mp4` | Só o painel (sem narração) |
| `npm run render:aluno` | `out/arenahub-aluno.mp4` | Só o app do aluno (sem narração) |
| `npm run render:abertura` | `out/arenahub-abertura.mp4` | A vinheta solta |
| `npm run acelerar` | `public/videos/*--Nx.mp4` | Acelera as gravações |
| `npm run gerar:sfx` | `public/audio/sfx/` | Gera os efeitos sonoros |
| `npm run still` | `out/capa.png` | O primeiro frame — a capa no WhatsApp |

## O que editar

Quase tudo mora em [`src/config.ts`](src/config.ts):

- **`APRESENTACAO`** — o que a abertura diz sobre o ArenaHub antes de falar de
  problema nenhum. O vídeo começa apresentando; as dores vêm depois.
- **`DORES`** — o título, os quatro tópicos e o fecho da segunda tela da abertura.
  É a parte que precisa funcionar **sem som**, que é como o WhatsApp toca vídeo.
  Frase curta e concreta ganha de frase esperta: o teste é o dono ler e pensar
  "isso é a minha terça-feira".
- **`CLIPES[].velocidade`** — a gravação inteira passa a essa velocidade: `20` no
  painel (20 min viram 1 min), `10` no aluno (5 min viram 30 s). **Mudou o número?
  Rode `npm run acelerar` de novo** — a aceleração está no arquivo, não na hora de tocar.
- **`CLIPES[].orientacao`** — `'auto'` lê a proporção do arquivo. Se a moldura sair
  errada (gravação de desktop dentro de um celular desenhado), force `'paisagem'`
  ou `'retrato'` aqui.
- **`NARRACAO_CONVITE` / `NARRACAO_DEMO` / `TRILHA` / `EFEITOS`** — as faixas de
  áudio, cada uma com o segundo em que entra. Arquivos em `public/audio/`.
  **Se o áudio não aparecer, é quase sempre isto: o arquivo está na pasta mas a
  linha continua comentada no config.** Cada vídeo tem a sua lista porque os dois
  têm blocos e durações diferentes — uma lista só faria as faixas de um cair no
  lugar errado do outro, ou fora dele.
- **`CONVITE`** — as seis imagens que passam dentro do celular, quanto tempo cada uma
  fica, e o fecho. O Convite mostra **prints parados**, não a gravação: em 40 s, vídeo
  acelerado vira borrão e o contato não entende nenhuma tela; um print com um rótulo ele
  lê inteiro em três segundos.
- **`FORMATO`** — orientação da Apresentação. O Convite é sempre vertical.

## O que o projeto resolve sozinho

**A duração não se digita.** `src/Root.tsx` mede o arquivo que vai tocar e monta a
linha do tempo a partir dele. Regravar mais longo ou mudar a velocidade não exige
mexer em número nenhum — só rodar `npm run acelerar` de novo.

**A moldura se escolhe sozinha** pela proporção do arquivo: gravação vertical entra
num aparelho desenhado, com painel de argumentos na sobra lateral; gravação de
desktop entra numa janela. Quando o arquivo não expõe as dimensões, o projeto
**avisa no console** e assume paisagem, em vez de adivinhar em silêncio.

**A trilha abaixa quando você fala.** As janelas de ducking saem da medição dos
próprios arquivos de narração, então continuam certas depois de regravar uma faixa.

## Por que a aceleração acontece ANTES

`npm run acelerar` gera `admin--20x.mp4` a partir de `admin.mp4`, e o vídeo toca esse
arquivo a 1×. Parece um passo a mais, e é o que faz o resto funcionar:

- **O `playbackRate` de um elemento de vídeo para em 16×.** Acima disso o navegador
  levanta `NotSupportedError` e o Studio não abre a composição.
- **A saída óbvia para passar disso — saltar quadro a quadro — deixa a tela PRETA.** Ela
  obriga o Studio a buscar posição nova 30 vezes por segundo num arquivo de 20 min, e a
  busca nunca termina. Pior: o render funcionava, então o defeito só aparecia na hora de
  conferir o corte.

Com o arquivo pronto não há teto de velocidade, o Studio abre instantâneo (é um arquivo
de 1 min, não de 20) e o render fica mais rápido. Se o acelerado não existir, o projeto
toca o bruto limitado a 16× e **avisa no console** o que rodar — o vídeo sai mais longo
do que o pedido, mas visível.

## Arquivos

| Arquivo | O que é |
|---|---|
| `src/config.ts` | **A única coisa que você precisa editar.** |
| `NARRACAO.md` | Roteiros, tempos, mensagens de WhatsApp e como gravar. |
| `src/Root.tsx` | Lista as composições, mede as gravações e a narração. |
| `src/Convite.tsx` | A montagem do vídeo curto. |
| `src/Demo.tsx` | A montagem da apresentação, e as faixas de áudio. |
| `src/Abertura.tsx` | Os dois atos: a apresentação e as dores em tópicos. |
| `src/Capitulo.tsx` | O cartão que anuncia cada gravação. |
| `src/Clipe.tsx` | A moldura, o painel lateral e a gravação tocando inteira. |
| `src/Galeria.tsx` | As telas paradas que o Convite mostra. |
| `src/fonte.ts` | Qual arquivo tocar (bruto ou acelerado) e quanto tempo ele ocupa. |
| `src/Encerramento.tsx` | O último quadro da apresentação. |
| `src/theme.ts` | As cores, espelhando `tailwind.config.ts`. |
| `src/componentes/Quadra.tsx` | A quadra em perspectiva usada de fundo. |
| `src/componentes/tipografia.ts` | Carrega Sora e Inter de `public/fonts`. |
| `scripts/acelerar.mjs` | Gera as cópias aceleradas das gravações. |
| `scripts/gerar-sfx.mjs` | Sintetiza os efeitos sonoros, sem dependência. |

As fontes são servidas de `public/fonts/` e não do CDN do Google: pelo CDN o render
dispara mais de cem requisições por aba, e um render sem rede cairia para a fonte de
sistema **entregando o vídeo com outra tipografia sem avisar**.
