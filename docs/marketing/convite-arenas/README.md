# Convite para arenas: kit impresso e digital

> Companion do [plano de marketing](../2026-07-29-plano-marketing-aquisicao.md). O plano diz que 70% do esforço é prospecção 1‑a‑1 em ~60 a 120 arenas de BH. Este kit é a peça física dessa conversa.

---

## Estado

Os arquivos em [`out/`](out/) estão **prontos para a gráfica**. Contato impresso na peça:
WhatsApp `(31) 99631-3913` · `arenahub.website` · `@arenahub.app`.

Para trocar qualquer um deles, edite [`src/config.js`](src/config.js) e rode `npm run build`
(instruções no fim). Os arquivos em `out/` são regerados.

---

## 1. Por que convite dobrado e não flyer

A pesquisa é consistente em três pontos, e os três empurram para a mesma peça:

- **Formato importa mais que a mensagem.** Peça dimensional/premium responde **5% a 15%**; folheto plano fica em **1% a 5%**; cartão-postal em **0,5% a 2%**. A diferença não é o texto. É a peça exigir manipulação física antes de virar lixo.
- **QR só entrega se tiver ordem clara.** Códigos com CTA explícito ("aponte a câmera") e identidade visual batem os genéricos. Escuro sobre claro é a combinação confiável. Por isso o QR aqui mora num painel branco, e **não** no fundo escuro do app.
- **Escaneamento não caiu.** América Latina cresceu ~40% em escaneamentos no último ciclo. QR em impresso não é gimmick datado.

O modelo escolhido junta as três coisas e resolve o que você pediu, que é *convidar* e não entregar:

**Convite quadrado 150 × 150 mm, dobrado, lacrado com selo adesivo.**

Três estados, três funções:

| Estado | O que é | Para quê |
|---|---|---|
| **Fechado e lacrado** | Capa escura, nome da arena escrito à mão, selo laranja | O momento da entrega. Quebrar o lacre é o gesto que separa convite de panfleto |
| **Aberto** | Carta sua à esquerda, prova à direita, preço em destaque | A leitura única, feita com calma depois que você saiu |
| **Aberto em pé no balcão** | Vira display: capa de um lado, QR grande do outro | O rabo longo. O aluno da arena também escaneia |

Esse terceiro estado é o motivo do quadrado e da gramatura alta: **300 g dobrado em 150 × 150 fica em pé sozinho no balcão da recepção.** Um A5 plano não fica. Você não entrega um impresso, você instala um display.

---

## 2. O que tem no kit

Tudo em [`out/`](out/), gerado por código. Não tem arquivo de Canva ou Photoshop no meio.

### Para a gráfica

| Arquivo | O que é |
|---|---|
| `ArenaHub-Convite-COM-MARCAS.pdf` | 2 páginas, 326 × 176 mm. Marcas de corte, marca de vinco tracejada, `↑ TOPO` e barra de instrução. **Mande este.** |
| `ArenaHub-Convite-SANGRIA-3mm.pdf` | 2 páginas, 306 × 156 mm. Só arte + sangria, sem marcas. Para gráfica que impõe sozinha e pede o arquivo limpo. |
| `ArenaHub-Selo-Adesivo-40mm.pdf` | Selo redondo Ø 40 mm com 3 mm de sangria. |
| `preview-300dpi-1-externa.png` · `-2-interna.png` | A mesma arte rasterizada a 300 dpi (3616 × 1844 px). Reserva, caso o pré‑impressão prefira imagem achatada ao vetor. |

### Para o WhatsApp

| Arquivo | Onde usar |
|---|---|
| `ArenaHub-Convite-WhatsApp-1080x1350.png` | Mensagem direta para o dono da arena, e post no feed |
| `ArenaHub-Convite-Story-1080x1920.png` | Stories do Instagram e status do WhatsApp |
| `preview-3-selo.png` | Conferência visual do selo |

---

## 3. Especificação técnica para copiar e mandar para a gráfica

### Peça 1 · Convite

| Item | Especificação |
|---|---|
| **Formato aberto** | 300 × 150 mm |
| **Formato fechado** | 150 × 150 mm |
| **Dobra** | 1 dobra vertical no centro, a 150 mm, **com vinco mecânico antes de dobrar** |
| **Papel** | Couché fosco **300 g/m²** (alternativa mais rígida: 350 g/m²) |
| **Impressão** | 4/4 (colorido frente e verso) |
| **Acabamento** | Laminação **soft touch fosca** frente e verso + **verniz localizado (UV)** sobre os elementos laranja e o logo |
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

Sora (títulos) e Inter (corpo), mais Caveat na assinatura manuscrita. Vão **embutidas no PDF como Type 3**, ou seja, os contornos viajam dentro do arquivo. Não existe risco de substituição de fonte. Se o pré‑impressão pedir "fontes convertidas em curvas", pode responder que já estão.

---

## 4. Três coisas que dão errado nesse tipo de peça

Vale conferir na hora de fechar o pedido:

1. **Fundo escuro sem laminação risca.** Uma chapada quase preta marca com unha, dedo e transporte. A laminação fosca não é enfeite, é proteção. E o soft touch ainda dá a textura aveludada que combina com o tema dark do app. Se cortar a laminação para economizar, aceite que parte da tiragem vai chegar marcada.
2. **Dobra em papel escuro racha e mostra o miolo branco.** Exija **vinco mecânico antes da dobra** e peça para dobrar no sentido das fibras. Sem vinco, aparece uma linha branca no meio da capa.
3. **Verniz brilhante em cima do QR atrapalha a leitura.** O reflexo cega a câmera em ângulo. O verniz localizado é só nos elementos laranja e no logo, e **o painel do QR fica fosco**. Deixe isso explícito no pedido.

---

## 5. Texto pronto para pedir orçamento

> Olá! Preciso de orçamento para duas peças:
>
> **1) Convite dobrado.** 150 × 150 mm fechado / 300 × 150 mm aberto, 1 dobra vertical central com vinco, couché fosco 300 g/m², impressão 4/4, laminação soft touch fosca frente e verso, verniz localizado (UV) apenas nos elementos laranja e no logo (o painel do QR code precisa ficar FOSCO, sem verniz). Sangria 3 mm. Arquivo PDF vetorial fechado com marcas de corte. Tiragem: 150 unidades.
>
> **2) Adesivo redondo.** Ø 40 mm, couché adesivo brilho, impressão 4/0, corte circular, sangria 3 mm. Tiragem: 200 unidades.
>
> Preciso de **prova de cor** antes da tiragem, porque a peça tem chapada escura e um laranja de marca que preciso conferir. Podem me passar prazo e valor com e sem o soft touch?

**Ordem de grandeza para você não ser surpreendido** (estimativa para calibrar expectativa; peça 3 orçamentos, o valor varia muito entre gráficas):

| Configuração | 150 un | Por unidade |
|---|---|---|
| Convite completo (soft touch + verniz localizado) | ~R$ 600 a 1.200 | R$ 4 a 8 |
| Convite sem soft touch e sem verniz | ~R$ 300 a 600 | R$ 2 a 4 |
| Selo adesivo (200 un) | ~R$ 80 a 180 | R$ 0,40 a 0,90 |

**Plano B se apertar:** cartão único 150 × 150 mm, 4/4, couché fosco 300 g, laminação fosca, sem dobra e sem verniz. Você perde a carta interna e o gesto de abrir; economiza cerca de 40%.

---

## 6. Como entregar, que é onde vira convite

A peça sozinha não converte. O ritual converte:

1. **Escreva o nome da arena à mão** na linha da capa. Manuscrito é o que faz a arena entender que a peça foi feita para ela, e não impressa aos milhares.
2. **Numere** (`Nº 07 / 60`). O número é verdade: você mapeou ~60 arenas em BH. Escassez real não precisa de invenção.
3. **Feche e cole o selo** por cima da abertura, do lado direito.
4. **Entregue na mão do dono.** Se ele não estiver, volte. Convite deixado na recepção vira panfleto.
5. **Fale uma frase e vá embora:** *"Não vim vender nada, vim te deixar um convite. Abre com calma depois."* Não fique esperando reação, a peça trabalha sozinha.
6. **Follow‑up em 48 h no WhatsApp:** *"Passei aí na terça e deixei um convite pra você. Conseguiu abrir?"* O convite físico te dá o direito de mandar essa mensagem, que é o ponto todo.

**Caneta:** em laminação soft touch, caneta comum borra. Use **gel branco (uni‑ball Signo Broad) ou Posca PC‑3M branca**, e deixe secar ~30 s. Teste em uma peça antes de escrever nas 150.

---

## 7. Peça digital e mensagem pronta

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

## 8. Decisões técnicas que valem saber

**Os dois QR fazem trabalhos diferentes.** O da contracapa (56 mm) vai para o **Instagram**: é descoberta, serve para o dono e para o aluno que passar pelo balcão. O de dentro (25 mm) vai para **`arenahub.website/criar-academia`**: é conversão, para quem já leu e decidiu. Um QR só teria que servir aos dois momentos e serviria mal a ambos.

**Os dois apontam direto para o destino final, sem encurtador.** É o que você pediu, e tem uma vantagem: link direto passa mais confiança que um `bit.ly` e não depende de serviço de terceiro que pode sair do ar com a peça já impressa. **O custo é que você não mede escaneamento nenhum.** Se quiser medir, o caminho limpo é criar uma rota própria (`arenahub.website/ig` redirecionando para o Instagram) e apontar o QR para ela. Mas decida **antes** de imprimir, porque papel não tem deploy.

**Correção de erro em nível H.** Os códigos recuperam 30% de área danificada, que é o que autoriza o furo do logo no centro e o que dá margem para papel amassado ou marcado.

**O QA roda de verdade.** `npm run verify` checa duas coisas: o tamanho físico do módulo impresso (1,24 mm na contracapa e 0,56 mm na parte interna, contra um mínimo prático de 0,4 mm) e a decodificação real dos códigos, a partir das imagens geradas, em resoluções de câmera de celular ruim para cima. Os dois QR decodificam a partir de 120 px, bem abaixo do pior caso plausível.

---

## 9. Regerar os arquivos

```bash
cd docs/marketing/convite-arenas/src
npm install
npm run build     # gera tudo em ../out
npm run verify    # QA dos QR codes
```

Precisa de Node 18+. O Chromium vem do Playwright; se o binário estiver em outro lugar, aponte com `PLAYWRIGHT_CHROMIUM=/caminho/para/chrome`.

| Arquivo | O que faz |
|---|---|
| [`src/config.js`](src/config.js) | Textos, links, preço, cores, medidas. **Mexa aqui primeiro.** |
| [`src/art.js`](src/art.js) | O desenho de todas as peças (HTML + SVG) |
| [`src/qr.js`](src/qr.js) | Gerador de QR com módulos arredondados e logo central |
| [`src/build.js`](src/build.js) | Renderiza PDFs e PNGs pelo Chromium |
| [`src/verify.js`](src/verify.js) | QA dos QR codes |

Uma observação de precisão: o PDF sai com 305,8 × 156 mm em vez de 306 × 156 mm, porque o renderizador arredonda para pontos inteiros. São 0,2 mm dentro de uma sangria de 3 mm, e não afeta o corte, que continua em 300 × 150 mm.

---

## Fontes da pesquisa

- [Direct Mail Response Rates 2026 · MPA](https://www.mailpro.org/post/direct-mail-response-rates/) · [B2B Direct Mail Playbook 2026](https://www.mailpro.org/post/b2b-direct-mail-marketing/) · [Direct Mail Flyers: Design Tips, Standard Sizes & Costs 2026](https://www.mailpro.org/post/direct-mail-flyers/)
- [Direct Mail Response Rates and ROI: 2026 Benchmarks for B2B · Manhattan Digital Direct](https://manhattandd.com/direct-mail-response-rates-and-roi-2026-benchmarks-for-b2b-marketers/) · [Direct-Mail Response Rates by Industry 2026 · Focus Digital](https://focus-digital.co/direct-mail-response-rates-by-industry/)
- [State of QR Code Scans 2026 · Bitly](https://bitly.com/blog/state-of-qr-code-scans-2026/) · [QR Code Statistics 2026 · QRCodeChimp](https://www.qrcodechimp.com/qr-code-statistics/) · [Taxa de adoção de QR code · QR Code Tiger](https://www.qrcode-tiger.com/pt/qr-code-adoption-rate)
- [QR Code Size Guide: Minimum Dimensions 2026](https://www.qr-insights.com/blog/2026-02-24-qr-code-size-guide-minimum-dimensions) · [Tamanho mínimo de QR Code impresso · QR Plus](https://www.qrplus.com.br/blog/artigo/qual-o-tamanho-minimo-de-um-qr-code-impresso) · [Best Practices for Printing and Placing QR Codes · Scantrust](https://help.scantrust.com/hc/en-us/articles/10319203706652-e-label-Editor-QR-Code-What-to-Consider-when-Printing-and-Placing-QR-Codes-Best-Practices)
- [Sangria e marcas de corte · Printi](https://www.printi.com.br/blog/o-que-sao-sangria-e-marcas-de-corte) · [Fechamento de arquivo para gráfica · VR SYS](https://www.vrsys.com.br/blog/como-fazer-o-fechamento-de-arquivo-para-grafica-de-modo-correto) · [Orientação de envio de arquivos · Gráfica 24 Horas](https://grafica24hs.com.br/orientacao-de-envio-dos-arquivos/)
