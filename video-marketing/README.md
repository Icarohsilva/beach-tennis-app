# Vídeo de demonstração do ArenaHub (Remotion)

Monta o vídeo que vai para o cliente no primeiro contato: **abertura de marca →
gravação do aluno → gravação do painel da arena → chamada para ação**. A edição
é código, então trocar um corte, um texto ou a ordem é editar um arquivo e
renderizar de novo — não é refazer a edição na mão.

É um projeto **separado do app Next**: tem o próprio `package.json` e o próprio
`node_modules`. Nada aqui entra no build da Vercel.

## Antes de rodar

Coloque as duas gravações em `public/videos/` **na raiz do repositório** (não
dentro desta pasta):

```
public/videos/aluno.mp4
public/videos/admin.mp4
```

Esses arquivos são ignorados pelo git de propósito: são pesados, e `public/` é
publicado no deploy — gravação bruta commitada iria junto para a web.

## Rodar

```bash
cd video-marketing
npm install          # só na primeira vez

npm run studio       # editor visual em localhost:3000 — veja e ajuste antes de renderizar
npm run render       # gera out/arenahub-demo.mp4  (o vídeo completo)
```

O primeiro render baixa o navegador que o Remotion usa (~110 MB), uma vez só.

### Outros alvos

| Comando | Sai em | Para quê |
|---|---|---|
| `npm run render` | `out/arenahub-demo.mp4` | O vídeo completo |
| `npm run render:aluno` | `out/arenahub-aluno.mp4` | Só a parte do aluno |
| `npm run render:arena` | `out/arenahub-arena.mp4` | Só a parte do painel |
| `npm run render:abertura` | `out/arenahub-abertura.mp4` | A vinheta solta, para reusar em outro vídeo |
| `npm run still` | `out/capa.png` | Imagem de capa (thumbnail) |

## O que editar

Quase tudo mora em [`src/config.ts`](src/config.ts):

- **`CLIPES`** — um item por gravação: nome do arquivo, título e subtítulo do
  cartão de capítulo, os `destaques` do painel lateral, os cortes e as legendas.
- **`cortarInicio` / `cortarFim`** — em segundos. É assim que se joga fora o
  tempo morto do começo (procurar a tela, digitar senha) e do fim.
- **`velocidade`** — acelera a gravação. `10` transforma 5 min em 30 s; `20`
  transforma 20 min em 1 min. A linha do tempo se ajusta sozinha, e acima de 1
  aparece um selo "10×" no canto — sem ele o cliente acha que o app travou.
- **`legendas`** — `{ em, duracao, texto }`. `em` é o segundo no vídeo **final**,
  já acelerado: com `velocidade: 10`, o minuto 2:00 do bruto cai aos 12 s. Abra o
  `npm run studio`, arraste a linha do tempo até o momento, leia o segundo e
  anote aqui.
- **`NARRACAO`** — as faixas de áudio (narração e trilha), cada uma com o segundo
  em que entra. Os arquivos vão em `public/audio/`. O texto pronto para gravar,
  com os tempos de cada bloco, está em [NARRACAO.md](NARRACAO.md).
- **`CONTATO`** — o que aparece no encerramento.
- **`FORMATO`** — `'paisagem'` (1920×1080, para WhatsApp, e-mail e reunião) ou
  `'retrato'` (1080×1920, para stories). A abertura, os capítulos e o
  encerramento se readaptam sozinhos: tudo é escalado a partir da largura.

A duração de cada gravação **não** se digita: `src/Root.tsx` mede os arquivos com
`parseMedia`, divide pela `velocidade` e monta a linha do tempo a partir disso.
Trocar o `.mp4` por uma regravação mais longa não exige mexer em número nenhum.

Se a `velocidade` for alta demais para uma gravação curta, o bloco ficaria menor
que a transição e a montagem quebraria com um erro que não diz qual clipe é. Nesse
caso o projeto segura a duração num piso e **avisa no console** para você baixar a
velocidade — em vez de derrubar o render.

A mesma medição decide a moldura de cada clipe (`src/Clipe.tsx`): gravação
**vertical** entra num aparelho desenhado, com painel de argumentos na sobra
lateral; gravação **de desktop** entra numa janela e ocupa a largura toda. É o
que evita o vídeo de celular esticado ou entre duas tarjas pretas.

## Sobre acelerar demais

Aceleração uniforme resolve o tamanho do arquivo, não a legibilidade. Acima de
~8× nenhuma tela fica no ar tempo suficiente para ser lida: o cliente vê
movimento, não o produto. Se o resultado ficar corrido, o caminho não é baixar a
velocidade do bruto inteiro — é **escolher os trechos** que importam com
`cortarInicio`/`cortarFim` e acelerar pouco, ou gerar um clipe por assunto com
`render:aluno` e `render:arena`.

## Arquivos

| Arquivo | O que é |
|---|---|
| `src/config.ts` | **A única coisa que você precisa editar.** |
| `src/Root.tsx` | Lista as composições e mede as gravações. |
| `src/Demo.tsx` | A montagem: ordem dos blocos e transições. |
| `src/Abertura.tsx` | A vinheta de marca (a bola cai, o logo nasce do impacto). |
| `src/Capitulo.tsx` | O cartão que anuncia cada gravação. |
| `src/Clipe.tsx` | A moldura da gravação, o painel lateral e as legendas. |
| `src/Encerramento.tsx` | O último quadro, com a chamada para ação. |
| `NARRACAO.md` | O roteiro para gravar, os tempos e como montar o áudio. |
| `src/theme.ts` | As cores, espelhando `tailwind.config.ts`. |
| `src/componentes/Quadra.tsx` | A quadra em perspectiva usada de fundo. |
| `src/componentes/tipografia.ts` | Carrega Sora e Inter de `public/fonts`. |

As fontes são servidas de `public/fonts/` e não do CDN do Google: pelo CDN o
render dispara mais de cem requisições por aba, e um render sem rede cairia para
a fonte de sistema **entregando o vídeo com outra tipografia sem avisar**.
