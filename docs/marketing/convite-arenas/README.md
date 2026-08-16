# Convite para arenas: kit impresso e digital

> Companion do [plano de marketing](../2026-07-29-plano-marketing-aquisicao.md). O plano diz que 70% do esforço é prospecção 1‑a‑1 em ~60 a 120 arenas de BH. Este kit é a peça física dessa conversa.

---

## Estado

Os arquivos em [`out/`](out/) estão **prontos para a gráfica**. Contato impresso na peça:
WhatsApp `(31) 99631-3913` · `arenahub.website` · `@arenahub.app`.

Para trocar qualquer um deles, edite [`src/config.js`](src/config.js) e rode `npm run build`
(instruções no fim). Os arquivos em `out/` são regerados.

---

## 1. O que a peça diz

A parte de dentro fala **das dores do dono da arena**, não de quem fez o sistema:
a pergunta "sobrou vaga?" que não para, o caderno que vira caos e a inadimplência
que fica invisível. Do outro lado, o que entra no lugar, com destaque para o que
mais trava a decisão de quem nunca usou sistema nenhum: **a configuração das turmas
e dos alunos é feita junto nos primeiros acessos, e o suporte no WhatsApp é vitalício.**

O fundador aparece só na contracapa, como assinatura de contato. A peça convida em
nome do produto, não conta a história de ninguém.

---

## 2. Por que convite dobrado e não flyer

A pesquisa é consistente em três pontos, e os três empurram para a mesma peça:

- **Formato importa mais que a mensagem.** Peça dimensional/premium responde **5% a 15%**; folheto plano fica em **1% a 5%**; cartão-postal em **0,5% a 2%**. A diferença não é o texto. É a peça exigir manipulação física antes de virar lixo.
- **QR só entrega se tiver ordem clara.** Códigos com CTA explícito ("aponte a câmera") e identidade visual batem os genéricos. Escuro sobre claro é a combinação confiável. Por isso o QR aqui mora num painel branco, e **não** no fundo escuro do app.
- **Escaneamento não caiu.** América Latina cresceu ~40% em escaneamentos no último ciclo. QR em impresso não é gimmick datado.

O modelo escolhido junta as três coisas e resolve o que você pediu, que é *convidar* e não entregar:

**Convite quadrado 150 × 150 mm, dobrado, lacrado com selo adesivo.**

Três estados, três funções:

| Estado | O que é | Para quê |
|---|---|---|
| **Fechado e lacrado** | Capa escura, nome da arena impresso, selo laranja | O momento da entrega. Quebrar o lacre é o gesto que separa convite de panfleto |
| **Aberto** | As três dores à esquerda, o que entra no lugar à direita, preço em destaque | A leitura única, feita com calma depois que você saiu |
| **Aberto em pé no balcão** | Vira display: capa de um lado, QR grande do outro | O rabo longo. O aluno da arena também escaneia |

Esse terceiro estado é o motivo do quadrado e da gramatura alta: **300 g dobrado em 150 × 150 fica em pé sozinho no balcão da recepção.** Um A5 plano não fica. Você não entrega um impresso, você instala um display.

---

## 3. O que tem no kit

Tudo em [`out/`](out/), gerado por código. Não tem arquivo de Canva ou Photoshop no meio.

### Para a gráfica

| Arquivo | O que é |
|---|---|
| `ArenaHub-Convite-COM-MARCAS.pdf` | 2 páginas, 326 × 176 mm. Marcas de corte, marca de vinco tracejada, `↑ TOPO` e barra de instrução. **Mande este.** |
| `ArenaHub-Convite-SANGRIA-3mm.pdf` | 2 páginas, 306 × 156 mm. Só arte + sangria, sem marcas. Para gráfica que impõe sozinha e pede o arquivo limpo. |
| `ArenaHub-Selo-Adesivo-40mm.pdf` | Selo redondo Ø 40 mm com 3 mm de sangria. |
| `preview-300dpi-1-externa.png` · `-2-interna.png` | A mesma arte rasterizada a 300 dpi (3616 × 1844 px). Reserva, caso o pré‑impressão prefira imagem achatada ao vetor. |
| `ArenaHub-Ficha-Grafica-PROVA-3un.png` · `-150un.png` | Ficha de produção em A4, clara e legível no celular. Mande junto com o PDF: a gráfica lê formato, dobra e sangria de uma vez, em vez de garimpar num parágrafo. |

### Convites do lote (personalizados)

Ficam em [`out/convites/`](out/convites/), gerados por `npm run convites`. Um PDF por arena
mais um PDF com o lote inteiro, além da ficha da gráfica já com a contagem certa.

---

## 4. O fluxo de lote

O nome da arena vai **impresso na capa**, em Playfair Display. Isso muda a economia da
coisa: em vez de rodar cem peças em branco e escrever à mão, você gera só os convites
da semana e imprime esse punhado.

```bash
npm run convites -- "Aloha Beach" "Arena Fahel"
```

Sem argumentos, usa a lista de `arenas` em [`src/config.js`](src/config.js). Sai:

| Arquivo | Para quê |
|---|---|
| `ArenaHub-Convite-<Arena>.pdf` | Um por arena, para reimprimir uma sozinha |
| `ArenaHub-Convites-LOTE-<n>un.pdf` | O lote inteiro num arquivo, que é o que a gráfica prefere |
| `ArenaHub-Ficha-Grafica-LOTE-<n>un.png` | Ficha com a contagem do lote e o aviso de arte variável |
| `preview-capa.png` | Confira o nome antes de mandar imprimir |

**O aviso que a gráfica precisa ler:** cada convite tem arte diferente. No PDF do lote,
cada par de páginas é um convite (ímpar = externa, par seguinte = interna correspondente).
Embaralhar a ordem casa a capa de uma arena com o miolo de outra. A ficha já traz isso
em destaque.

Nomes longos não quebram o desenho: o corpo do nome cai por faixa de tamanho, de 13,5 mm
até 7,5 mm.

---

### Para o WhatsApp

| Arquivo | Onde usar |
|---|---|
| `ArenaHub-Convite-WhatsApp-1080x1350.png` | Mensagem direta para o dono da arena, e post no feed |
| `ArenaHub-Convite-Story-1080x1920.png` | Stories do Instagram e status do WhatsApp |
| `preview-3-selo.png` | Conferência visual do selo |

---

## 5. Especificação técnica para copiar e mandar para a gráfica

### Peça 1 · Convite

| Item | Especificação |
|---|---|
| **Formato aberto** | 300 × 150 mm |
| **Formato fechado** | 150 × 150 mm |
| **Dobra** | 1 dobra vertical no centro, a 150 mm, **com vinco mecânico antes de dobrar** |
| **Papel** | Couché fosco **300 g/m²** (alternativa mais rígida: 350 g/m²) |
| **Impressão** | 4/4 (colorido frente e verso) |
| **Acabamento** | Laminação **soft touch fosca** frente e verso + **verniz localizado (UV)** sobre os elementos laranja e o logo |
| **Acabamento opcional** | **Foil digital** (hot stamping digital, sem clichê) sobre o nome da arena e o logo. É o que a pesquisa aponta como o que faz o destinatário guardar a peça, e por ser digital funciona em tiragem pequena. Pergunte se a gráfica tem. |
| **Sangria** | 3 mm em todos os lados |
| **Arquivo** | PDF vetorial, fontes embutidas, 2 páginas (pág. 1 = externa, pág. 2 = interna) |
| **Aproveitamento** | 2 peças por folha SRA3 (32 × 45 cm) |
| **Tiragem sugerida** | 150 unidades (mínimo 100) |

### Peça 2 · Selo adesivo (o lacre)

| Item | Especificação |
|---|---|
| **Formato** | Redondo Ø 40 mm |
| **Papel** | Couché adesivo brilho, ou **vinil branco** se quiser aguentar suor e areia de quadra |
| **Impressão** | 4/0 |
| **Corte** | Faca circular Ø 40 mm |
| **Sangria** | 3 mm |
| **Tiragem** | 200 unidades (sobra é barata, e o selo é o que faz a peça parecer convite) |

### Cores

Os hexadecimais são os do app. **Não converta por conta própria.** Deixe a gráfica converter com o perfil ICC dela (Coated FOGRA39 ou US Web Coated SWOP) e **peça prova de cor antes de rodar a tiragem**.

| Uso | Hex | CMYK sugerido (ponto de partida) |
|---|---|---|
| Fundo | `#0c1220` | C 75 · M 62 · Y 40 · K 85 |
| Card interno | `#151e31` | C 72 · M 58 · Y 33 · K 60 |
| Borda / filete | `#26334d` | C 68 · M 52 · Y 30 · K 32 |
| Laranja da marca | `#f97316` | C 0 · M 65 · Y 95 · K 0 |
| Laranja escuro | `#ea580c` | C 0 · M 75 · Y 100 · K 5 |
| Texto principal | `#ffffff` | 0 · 0 · 0 · 0 |
| Texto secundário | `#94a3b8` | C 42 · M 28 · Y 20 · K 3 |

**O ponto que estraga a peça se passar batido:** o fundo tem que ser **preto rico** (os quatro canais), nunca 100% K sozinho. Preto de um canal só numa chapada desse tamanho imprime cinza lavado e a peça inteira perde. A soma sugerida dá 262% de cobertura, dentro do limite tanto de offset quanto de digital.

### Fontes

Sora (títulos), Inter (corpo) e Playfair Display (o nome da arena e o gancho da capa). Vão **embutidas no PDF como Type 3**, ou seja, os contornos viajam dentro do arquivo. Não existe risco de substituição de fonte. Se o pré‑impressão pedir "fontes convertidas em curvas", pode responder que já estão.

---

## 6. Três coisas que dão errado nesse tipo de peça

Vale conferir na hora de fechar o pedido:

1. **Fundo escuro sem laminação risca.** Uma chapada quase preta marca com unha, dedo e transporte. A laminação fosca não é enfeite, é proteção. E o soft touch ainda dá a textura aveludada que combina com o tema dark do app. Se cortar a laminação para economizar, aceite que parte da tiragem vai chegar marcada.
2. **Dobra em papel escuro racha e mostra o miolo branco.** Exija **vinco mecânico antes da dobra** e peça para dobrar no sentido das fibras. Sem vinco, aparece uma linha branca no meio da capa.
3. **Verniz brilhante em cima do QR atrapalha a leitura.** O reflexo cega a câmera em ângulo. O verniz localizado é só nos elementos laranja e no logo, e **o painel do QR fica fosco**. Deixe isso explícito no pedido.

---

## 7. Texto pronto para pedir orçamento

> Olá! Preciso de orçamento para duas peças:
>
> **1) Convite dobrado.** 150 × 150 mm fechado / 300 × 150 mm aberto, 1 dobra vertical central com vinco, couché fosco 300 g/m², impressão 4/4, laminação soft touch fosca frente e verso, verniz localizado (UV) apenas nos elementos laranja e no logo (o painel do QR code precisa ficar FOSCO, sem verniz). Sangria 3 mm. Arquivo PDF vetorial fechado com marcas de corte. Tiragem: 150 unidades.
>
> **2) Adesivo redondo.** Ø 40 mm, couché adesivo brilho, impressão 4/0, corte circular, sangria 3 mm. Tiragem: 200 unidades.
>
> Preciso de **prova de cor** antes da tiragem, porque a peça tem chapada escura e um laranja de marca que preciso conferir. Podem me passar prazo e valor com e sem o soft touch?

### Antes da tiragem cheia: a prova de 3 unidades

Vale imprimir 3 antes de rodar 150. Em quantidade pequena, **soft touch e verniz
localizado não compensam** (são acabamentos com custo de preparação, e em 3 peças
custam mais que a tiragem inteira da versão simples), então a prova sai só com
laminação fosca. Isso ainda valida o que importa: a profundidade do fundo escuro,
se a dobra racha, se a peça fica em pé no balcão e se o QR lê no papel.

O que a prova **não** valida: o toque do soft touch, o brilho do verniz, e a cor
caso a tiragem cheia vá para offset em vez de digital.

Use a ficha `ArenaHub-Ficha-Grafica-PROVA-3un.png` e este texto:

> Oi! Preciso de uma prova de **3 unidades** antes de rodar a tiragem cheia (150).
>
> Convite dobrado ao meio: aberto **300 × 150 mm**, fechado **150 × 150 mm**, 1 dobra vertical no centro **com vinco antes de dobrar**. Couché fosco 300 g, impressão 4/4 digital, laminação fosca frente e verso (se tiverem filme soft touch, prefiro soft touch). Sangria 3 mm. Mando o PDF fechado com marcas de corte, 2 páginas.
>
> **Nesta prova de 3 não precisa de verniz localizado**, sei que não compensa em quantidade pequena. Quero validar a cor do fundo, a dobra e a leitura do QR code.
>
> Dois pontos: **(1)** o fundo é uma chapada quase preta, precisa ser preto rico nos quatro canais, senão sai cinza lavado; **(2)** nada de verniz brilhante sobre o QR code, ele precisa ficar fosco ou o reflexo atrapalha a leitura no celular.
>
> Me passa valor e prazo dessas 3, e também o valor de 150 unidades com laminação soft touch e verniz localizado só nos elementos laranja?

---

**Ordem de grandeza para você não ser surpreendido** (estimativa para calibrar expectativa; peça 3 orçamentos, o valor varia muito entre gráficas):

| Configuração | 150 un | Por unidade |
|---|---|---|
| Convite completo (soft touch + verniz localizado) | ~R$ 600 a 1.200 | R$ 4 a 8 |
| Convite sem soft touch e sem verniz | ~R$ 300 a 600 | R$ 2 a 4 |
| Selo adesivo (200 un) | ~R$ 80 a 180 | R$ 0,40 a 0,90 |

**Plano B se apertar:** cartão único 150 × 150 mm, 4/4, couché fosco 300 g, laminação fosca, sem dobra e sem verniz. Você perde a carta interna e o gesto de abrir; economiza cerca de 40%.

---

## 8. Como entregar, que é onde vira convite

A peça sozinha não converte. O ritual converte:

1. **Confira o nome na capa** antes de sair. O convite é nominal, e entregar o da arena errada é pior que não entregar.
2. **Feche e cole o selo** por cima da abertura, na borda direita da capa.
3. **Entregue na mão do dono.** Se ele não estiver, volte outro dia. Convite deixado na recepção vira panfleto.
4. **Fale uma frase e vá embora:** *"Não vim vender nada, vim te deixar um convite. Abre com calma depois."* Não fique esperando reação, a peça trabalha sozinha.
5. **Follow-up em 48 h no WhatsApp:** *"Passei aí na terça e deixei um convite pra você. Conseguiu abrir?"* O convite físico é o que te dá direito a essa mensagem, e esse é o ponto todo.

---

## 9. Peça digital e mensagem pronta

O QR no WhatsApp é para quando a imagem for mostrada na tela para outra pessoa, ou impressa. **Na conversa, o link vai no texto**, porque ninguém escaneia a própria tela.

> Oi, [nome]! Aqui é o Ícaro, criei o ArenaHub, um sistema de gestão feito pra arena e não pra academia de musculação adaptada.
>
> Grade, reposição, fila de espera, Wellhub e TotalPass, financeiro e torneios num app só. R$ 49,90/mês com alunos ilimitados e o primeiro mês grátis.
>
> Dá uma olhada nas telas reais aqui: instagram.com/arenahub.app
>
> Se fizer sentido, eu monto a sua grade em 5 minutos numa call. Se não fizer, sem problema nenhum.

Mande a imagem `ArenaHub-Convite-WhatsApp-1080x1350.png` junto.

---

## 10. Decisões técnicas que valem saber

**São três QR, com trabalhos diferentes.** Na contracapa ficam dois lado a lado, de
tamanhos diferentes de propósito: o maior vai para o **Instagram** (curiosidade, ver
antes de falar, e serve também para o aluno que passar pelo balcão) e o menor abre o
**WhatsApp**. Dentro da peça, um terceiro aponta para `arenahub.website/criar-academia`,
que é a ação de quem já decidiu. Empilhar os dois da contracapa não cabia no painel, e
deixá-los do mesmo tamanho daria paralisia de escolha.

**O QR do WhatsApp é personalizado por arena e abre a conversa já escrita.** O destino é
um `wa.me` com a mensagem pré-preenchida: *"Oi! Aqui é da Aloha Beach. Recebi o convite."*
Isso resolve duas coisas de uma vez. Tira o atrito de quem abriu o WhatsApp e não sabe o
que escrever, e te diz **exatamente qual convite gerou o contato**, que é a medição que o
link direto do Instagram não dá. A mensagem é curta de propósito: cada caractere vira
módulo no código, e módulo pequeno demais não lê no papel. Por isso esse código usa
correção Q em vez de H, e mesmo assim fica em 0,70 mm de módulo.

**O número e o @ continuam impressos como texto**, ao lado dos códigos. Quem prefere
digitar, digita; quem quer salvar o contato, salva; e se um QR falhar, a peça continua
funcionando.

**Correção de erro em nível H.** Os códigos recuperam 30% de área danificada, que é o que autoriza o furo do logo no centro e o que dá margem para papel amassado ou marcado.

**O QA roda de verdade.** `npm run verify` checa duas coisas: o tamanho físico do módulo impresso (1,24 mm na contracapa e 0,56 mm na parte interna, contra um mínimo prático de 0,4 mm) e a decodificação real dos códigos, a partir das imagens geradas, em resoluções de câmera de celular ruim para cima. Os dois QR decodificam a partir de 120 px, bem abaixo do pior caso plausível.

---

## 11. Regerar os arquivos

```bash
cd docs/marketing/convite-arenas/src
npm install
npm run build     # gera tudo em ../out
npm run verify    # QA dos QR codes
npm run convites  # gera o lote com os nomes das arenas
```

Precisa de Node 18+. O Chromium vem do Playwright; se o binário estiver em outro lugar, aponte com `PLAYWRIGHT_CHROMIUM=/caminho/para/chrome`.

| Arquivo | O que faz |
|---|---|
| [`src/config.js`](src/config.js) | Textos, links, preço, cores, medidas. **Mexa aqui primeiro.** |
| [`src/art.js`](src/art.js) | O desenho de todas as peças (HTML + SVG) |
| [`src/qr.js`](src/qr.js) | Gerador de QR com módulos arredondados e logo central |
| [`src/build.js`](src/build.js) | Renderiza PDFs e PNGs pelo Chromium |
| [`src/verify.js`](src/verify.js) | QA dos QR codes |
| [`src/convites.js`](src/convites.js) | Gera o lote personalizado, um PDF por arena |

Uma observação de precisão: o PDF sai com 305,8 × 156 mm em vez de 306 × 156 mm, porque o renderizador arredonda para pontos inteiros. São 0,2 mm dentro de uma sangria de 3 mm, e não afeta o corte, que continua em 300 × 150 mm.

---

## Fontes da pesquisa

- [Direct Mail Response Rates 2026 · MPA](https://www.mailpro.org/post/direct-mail-response-rates/) · [B2B Direct Mail Playbook 2026](https://www.mailpro.org/post/b2b-direct-mail-marketing/) · [Direct Mail Flyers: Design Tips, Standard Sizes & Costs 2026](https://www.mailpro.org/post/direct-mail-flyers/)
- [Direct Mail Response Rates and ROI: 2026 Benchmarks for B2B · Manhattan Digital Direct](https://manhattandd.com/direct-mail-response-rates-and-roi-2026-benchmarks-for-b2b-marketers/) · [Direct-Mail Response Rates by Industry 2026 · Focus Digital](https://focus-digital.co/direct-mail-response-rates-by-industry/)
- [State of QR Code Scans 2026 · Bitly](https://bitly.com/blog/state-of-qr-code-scans-2026/) · [QR Code Statistics 2026 · QRCodeChimp](https://www.qrcodechimp.com/qr-code-statistics/) · [Taxa de adoção de QR code · QR Code Tiger](https://www.qrcode-tiger.com/pt/qr-code-adoption-rate)
- [QR Code Size Guide: Minimum Dimensions 2026](https://www.qr-insights.com/blog/2026-02-24-qr-code-size-guide-minimum-dimensions) · [Tamanho mínimo de QR Code impresso · QR Plus](https://www.qrplus.com.br/blog/artigo/qual-o-tamanho-minimo-de-um-qr-code-impresso) · [Best Practices for Printing and Placing QR Codes · Scantrust](https://help.scantrust.com/hc/en-us/articles/10319203706652-e-label-Editor-QR-Code-What-to-Consider-when-Printing-and-Placing-QR-Codes-Best-Practices)
- [Sangria e marcas de corte · Printi](https://www.printi.com.br/blog/o-que-sao-sangria-e-marcas-de-corte) · [Fechamento de arquivo para gráfica · VR SYS](https://www.vrsys.com.br/blog/como-fazer-o-fechamento-de-arquivo-para-grafica-de-modo-correto) · [Orientação de envio de arquivos · Gráfica 24 Horas](https://grafica24hs.com.br/orientacao-de-envio-dos-arquivos/)
