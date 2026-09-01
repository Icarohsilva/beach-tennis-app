# Vídeos de demonstração do ArenaHub (Remotion)

Monta em código os dois vídeos da prospecção. A edição é código, então trocar um corte,
um texto ou a ordem é editar um arquivo e renderizar de novo — não é refazer a edição
na mão.

| | **Convite** | **Apresentação** |
|---|---|---|
| Quando | Junto do primeiro "oi" no WhatsApp | Depois que a arena responde |
| Duração | ~40 s | ~2 min |
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

Esses arquivos são ignorados pelo git de propósito: são pesados, e `public/` é publicado
no deploy — gravação bruta commitada iria junto para a web.

## Rodar

```bash
cd video-marketing
npm install          # só na primeira vez

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
- **`CLIPES[].trechos`** — **os números que mais valem o seu tempo.** Cada trecho é
  `{ de, ate, velocidade }` em segundos do bruto, e o vídeo é montado só com eles,
  em cortes secos. Abra a gravação, ache os momentos que vendem e anote. Dois a
  quatro trechos de 40-70 s a 2-4× por gravação é o alvo.
- **`CLIPES[].orientacao`** — `'auto'` lê a proporção do arquivo. Se a moldura sair
  errada (gravação de desktop dentro de um celular desenhado), force `'paisagem'`
  ou `'retrato'` aqui.
- **`NARRACAO_CONVITE` / `NARRACAO_DEMO` / `TRILHA` / `EFEITOS`** — as faixas de
  áudio, cada uma com o segundo em que entra. Arquivos em `public/audio/`.
  **Se o áudio não aparecer, é quase sempre isto: o arquivo está na pasta mas a
  linha continua comentada no config.** Cada vídeo tem a sua lista porque os dois
  têm blocos e durações diferentes — uma lista só faria as faixas de um cair no
  lugar errado do outro, ou fora dele.
- **`CONVITE`** — o que o convite pede no fim e os trechos curtos que ele usa.
- **`FORMATO`** — orientação da Apresentação. O Convite é sempre vertical.

## O que o projeto resolve sozinho

**Os trechos são aparados ao arquivo.** Um `ate` além do fim da gravação congelaria
o último quadro pelo tempo que sobrasse, sem avisar — e como os valores padrão são
chute até alguém abrir a gravação, esse é o caso comum. `src/Root.tsx` lê a duração
real e corta.

**A moldura se escolhe sozinha** pela proporção do arquivo: gravação vertical entra
num aparelho desenhado, com painel de argumentos na sobra lateral; gravação de
desktop entra numa janela. Quando o arquivo não expõe as dimensões, o projeto
**avisa no console** e assume paisagem, em vez de adivinhar em silêncio.

**A trilha abaixa quando você fala.** As janelas de ducking saem da medição dos
próprios arquivos de narração, então continuam certas depois de regravar uma faixa.

## Por que o vídeo não é a gravação inteira acelerada

Foi tentado, e as duas tentativas quebraram:

- **Acelerar muito não deixa ver nada.** 20 min em 1 min são 20×, e a essa taxa
  nenhuma tela fica no ar tempo suficiente para ser lida. Vira movimento colorido.
- **Acelerar muito não é sequer possível.** O `playbackRate` de um elemento de vídeo
  para em 16× (`NotSupportedError`), e a saída de saltar quadro a quadro faz o
  Studio buscar posição nova 30 vezes por segundo num arquivo longo: a busca nunca
  termina e **a tela fica preta**. O render funcionava, o Studio não — o defeito só
  aparecia na hora de conferir o corte.

Daí os trechos: pedaços escolhidos, tocados de ponta a ponta a 2-4×, com um único
posicionamento no início de cada um. O vídeo corre solto, e quem carrega o peso é a
narração. O teto de 16× continua valendo e mora em `VELOCIDADE_MAX`
(`src/segmentos.ts`), aplicado no mesmo lugar que calcula a duração — cortar só na
hora de tocar faria o bloco acabar antes do que a montagem reservou.

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
| `src/Clipe.tsx` | A moldura, o painel lateral e a série de trechos. |
| `src/segmentos.ts` | A matemática dos trechos, usada pelo Root e pelo Clipe. |
| `src/Encerramento.tsx` | O último quadro da apresentação. |
| `src/theme.ts` | As cores, espelhando `tailwind.config.ts`. |
| `src/componentes/Quadra.tsx` | A quadra em perspectiva usada de fundo. |
| `src/componentes/tipografia.ts` | Carrega Sora e Inter de `public/fonts`. |
| `scripts/gerar-sfx.mjs` | Sintetiza os efeitos sonoros, sem dependência. |

As fontes são servidas de `public/fonts/` e não do CDN do Google: pelo CDN o render
dispara mais de cem requisições por aba, e um render sem rede cairia para a fonte de
sistema **entregando o vídeo com outra tipografia sem avisar**.
