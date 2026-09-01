# Vídeos de demonstração do ArenaHub (Remotion)

Monta em código os dois vídeos da prospecção. A edição é código, então trocar um corte,
um texto ou a ordem é editar um arquivo e renderizar de novo — não é refazer a edição
na mão.

| | **Convite** | **Apresentação** |
|---|---|---|
| Quando | Junto do primeiro "oi" no WhatsApp | Depois que a arena responde |
| Duração | ~35 s | ~1:57 |
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

- **`DORES`** — as três frases que abrem os dois vídeos, antes de qualquer marca. São o
  gancho, e a única coisa que precisa funcionar **sem som**. Frase curta e concreta ganha
  de frase esperta: o teste é o dono ler e pensar "isso é a minha terça-feira".
- **`CLIPES`** — uma entrada por gravação, **na ordem em que aparecem** (arena primeiro).
  Título e subtítulo do cartão, `destaques` do painel lateral, cortes, velocidade,
  paradas e legendas.
- **`velocidade`** — `10` transforma 5 min em 30 s; `20` transforma 20 min em 1 min.
  Acima de 1,5× aparece um selo "10×" no canto — sem ele o cliente acha que o app travou.
- **`paradas`** — `{ em, duracao, texto }`. A imagem **congela** com um rótulo grande.
  É o que salva a gravação acelerada: a 20× nada fica no ar tempo suficiente para ser
  lido, e legenda por cima de imagem ilegível não resolve. Quatro por bloco é o alvo.
- **`NARRACAO` / `TRILHA` / `EFEITOS`** — as faixas de áudio, cada uma com o segundo em
  que entra. Arquivos em `public/audio/`.
- **`CONVITE`** — o que o convite pede no fim, e quantos segundos de cada gravação
  entram na montagem curta.
- **`FORMATO`** — orientação da Apresentação. O Convite é sempre vertical.

## O que o projeto resolve sozinho

**A duração não se digita.** `src/Root.tsx` mede os arquivos com `parseMedia`, divide
pela `velocidade`, soma as paradas e monta a linha do tempo. Trocar o `.mp4` por uma
regravação mais longa não exige mexer em número nenhum.

**A moldura se escolhe sozinha.** A mesma medição lê a orientação: gravação vertical
entra num aparelho desenhado, com painel de argumentos na sobra lateral; gravação de
desktop entra numa janela e ocupa a largura toda. É o que evita o vídeo de celular
esticado ou entre duas tarjas pretas.

**A velocidade do Convite se calcula.** O convite pede "me dá 8 segundos desta gravação"
e a velocidade sai da duração real do arquivo — a mesma gravação serve aos dois vídeos.

**A trilha abaixa quando você fala.** As janelas de ducking saem da medição dos próprios
arquivos de narração, então continuam certas depois de regravar uma faixa.

Se a `velocidade` for alta demais para uma gravação curta, o bloco ficaria menor que a
transição e a montagem quebraria com um erro que não diz qual clipe é. Nesse caso o
projeto segura a duração num piso e **avisa no console** para você baixar a velocidade.

## Arquivos

| Arquivo | O que é |
|---|---|
| `src/config.ts` | **A única coisa que você precisa editar.** |
| `NARRACAO.md` | Roteiros, tempos, mensagens de WhatsApp e como gravar. |
| `src/Root.tsx` | Lista as composições, mede as gravações e a narração. |
| `src/Convite.tsx` | A montagem do vídeo curto. |
| `src/Demo.tsx` | A montagem da apresentação, e as faixas de áudio. |
| `src/Abertura.tsx` | Os dois atos: as dores e a marca nascendo do impacto. |
| `src/Capitulo.tsx` | O cartão que anuncia cada gravação. |
| `src/Clipe.tsx` | A moldura, o painel lateral, as paradas e as legendas. |
| `src/segmentos.ts` | A matemática das paradas, usada pelo Root e pelo Clipe. |
| `src/Encerramento.tsx` | O último quadro da apresentação. |
| `src/theme.ts` | As cores, espelhando `tailwind.config.ts`. |
| `src/componentes/Quadra.tsx` | A quadra em perspectiva usada de fundo. |
| `src/componentes/tipografia.ts` | Carrega Sora e Inter de `public/fonts`. |
| `scripts/gerar-sfx.mjs` | Sintetiza os efeitos sonoros, sem dependência. |

As fontes são servidas de `public/fonts/` e não do CDN do Google: pelo CDN o render
dispara mais de cem requisições por aba, e um render sem rede cairia para a fonte de
sistema **entregando o vídeo com outra tipografia sem avisar**.
