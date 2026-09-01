// -----------------------------------------------------------------------------
// A ÚNICA COISA QUE VOCÊ PRECISA EDITAR.
//
// Os vídeos ficam em ../public/videos e o áudio em ../public/audio (ou seja:
// public/ na raiz do repo), porque remotion.config.ts aponta o publicDir para lá.
//
// São DOIS vídeos, com funções diferentes na conversa:
//   Convite       ~40 s, vertical  — acompanha o "oi" no WhatsApp
//   Demo          ~2 min, horizontal — vai depois que a arena responde
// -----------------------------------------------------------------------------

/** O que a abertura diz sobre o ArenaHub, antes de falar de problema nenhum. */
export const APRESENTACAO = {
  convite: 'Te convido a conhecer o',
  descricao: 'O sistema que organiza as aulas, os pagamentos e a presença da sua arena — num app só.',
  pilares: ['Agenda', 'Pagamentos', 'Check-in', 'Comunidade'],
}

/**
 * As dores do dono, em tópicos, logo depois da apresentação.
 *
 * Frase curta e concreta ganha de frase esperta: o teste é o dono ler e pensar
 * "isso é a minha terça-feira". São também a única coisa na tela que precisa
 * funcionar SEM SOM, que é como o WhatsApp toca vídeo por padrão.
 */
export const DORES = {
  titulo: 'Se a sua arena vive isso:',
  itens: [
    'Aluno remarcando aula pelo WhatsApp, a qualquer hora',
    'Chamada no caderninho, presença que ninguém confere',
    'Mensalidade atrasada que você só descobre no fim do mês',
    'Fila de espera anotada num print do celular',
  ],
  fecho: 'Tem um jeito melhor.',
}

export type Clipe = {
  /** Nome do arquivo BRUTO dentro de public/videos */
  arquivo: string
  /** Título grande do cartão de capítulo */
  titulo: string
  /** Linha de apoio do cartão */
  subtitulo: string
  /** Numeração do capítulo ("01", "02"...) */
  indice: string
  /**
   * Pontos que ficam no painel ao lado do vídeo — só aparecem quando a gravação
   * é VERTICAL (celular) num quadro horizontal, que é quando sobra tela.
   */
  destaques: string[]
  /**
   * Como emoldurar a gravação. 'auto' lê a proporção do arquivo.
   *
   * Existe porque a leitura FALHA em silêncio: alguns arquivos devolvem duração
   * mas não dimensões, e aí o projeto teria de adivinhar — foi assim que uma
   * gravação de desktop apareceu dentro de uma moldura de celular, cortada dos
   * dois lados. Quando o automático errar, diga aqui e acabou.
   */
  orientacao?: 'auto' | 'paisagem' | 'retrato'
  /**
   * Quantas vezes mais rápido a gravação inteira passa.
   *
   * A aceleração NÃO acontece na hora de tocar: `npm run acelerar` gera antes um
   * arquivo já acelerado (`admin--20x.mp4`), e o vídeo toca esse a 1×. Foi a
   * saída para dois becos: o `playbackRate` do navegador para em 16×, e saltar
   * quadro a quadro para passar disso fazia o Studio buscar posição nova 30 vezes
   * por segundo num arquivo de 20 min — a busca nunca terminava e a tela ficava
   * PRETA. Com o arquivo pronto, qualquer velocidade funciona e o Studio abre
   * instantâneo.
   *
   * Rode `npm run acelerar` de novo sempre que mudar este número.
   */
  velocidade: number
  /**
   * Legendas por cima do vídeo (lower third). `em` é o segundo dentro do bloco
   * já montado. Opcional — a narração costuma bastar.
   */
  legendas: { em: number; duracao: number; texto: string }[]
}

/**
 * A ORDEM IMPORTA: a arena vem primeiro, o aluno depois.
 *
 * Quem decide a compra é o dono. Começando pelo aluno, ele passa os primeiros
 * 30 s — a janela em que mais gente abandona — vendo tela de alguém que ainda
 * não é problema dele. Invertido, ele vê a própria operação primeiro, e a
 * experiência do aluno vira o desfecho: é o que ele vai querer mostrar para os
 * alunos, então é o melhor gancho possível logo antes da chamada final.
 */
export const CLIPES: Clipe[] = [
  {
    arquivo: 'admin.mp4',
    titulo: 'A sua operação',
    subtitulo: 'Grade, chamada, mensalidade e inadimplência num lugar só.',
    indice: '01',
    orientacao: 'auto',
    destaques: [
      'Grade da semana gerada num clique',
      'Chamada no celular, na beira da quadra',
      'Quem está devendo, na tela',
      'Relatório de presença e ocupação',
    ],
    // ~20 min de gravação → ~1 min no vídeo.
    velocidade: 20,
    legendas: [],
  },
  {
    arquivo: 'aluno.mp4',
    titulo: 'E o que o seu aluno vê',
    subtitulo: 'Ele reserva, cancela e confirma presença sozinho. Sem te mandar mensagem.',
    indice: '02',
    orientacao: 'auto',
    destaques: [
      'Reserva a aula em dois toques',
      'Cancelou a tempo? O crédito volta sozinho',
      'Fila de espera que chama o próximo automaticamente',
      'Confirma presença na quadra pelo celular',
    ],
    // ~5 min de gravação → ~30 s no vídeo.
    velocidade: 10,
    legendas: [],
  },
]

/**
 * Faixas de áudio. Os arquivos vão em `public/audio/`.
 *
 * `em` é o segundo do vídeo FINAL em que a faixa começa. Narração por bloco é
 * mais fácil de manter do que uma faixa só: regravar 15 segundos não obriga a
 * regravar tudo, e mexer num trecho só desloca as faixas dali para a frente.
 *
 * Lista vazia = sem áudio. **Se o áudio não aparecer, é quase sempre isto: o
 * arquivo está na pasta mas a linha continua comentada aqui.**
 */
export type Faixa = {
  arquivo: string
  em: number
  /** 1 = volume cheio. Música de fundo pede algo entre 0.08 e 0.16. */
  volume: number
}

/**
 * Narração do CONVITE. Separada da narração do Demo de propósito: os dois vídeos
 * têm durações e blocos diferentes, e uma lista só faria as faixas de um cair no
 * lugar errado do outro — ou fora dele, sumindo sem aviso.
 */
export const NARRACAO_CONVITE: Faixa[] = [
  // Tempos recalculados a partir da duração REAL de cada gravação (não do
  // roteiro): 01 sozinho já dura 8,49s, então começar 02 aos 7s (como o
  // roteiro sugeria) faria as duas falarem por cima uma da outra por 2,3s.
  { arquivo: 'convite-01.mp3', em: 0.8, volume: 1 },   // apresentação
  { arquivo: 'convite-02.mp3', em: 9.7, volume: 1 },   // as dores
  { arquivo: 'convite-03.mp3', em: 17.3, volume: 1 },  // as telas
  { arquivo: 'convite-04.mp3', em: 32.2, volume: 1 },  // o fecho
]

/** Narração da APRESENTAÇÃO. Tempos em NARRACAO.md. */
export const NARRACAO_DEMO: Faixa[] = [
  // { arquivo: 'narracao-01-abertura.mp3', em: 0.8, volume: 1 },
  // { arquivo: 'narracao-02-dores.mp3', em: 7, volume: 1 },
  // { arquivo: 'narracao-03-arena.mp3', em: 18, volume: 1 },
  // { arquivo: 'narracao-04-aluno.mp3', em: 79, volume: 1 },
  // { arquivo: 'narracao-05-fecho.mp3', em: 108, volume: 1 },
]

/**
 * Música de fundo, uma faixa com `em: 0` cobrindo o vídeo inteiro.
 *
 * O volume aqui é o volume QUANDO NINGUÉM ESTÁ FALANDO: enquanto a narração
 * toca, a trilha abaixa sozinha. Sem isso, volume fixo ou come a voz ou deixa a
 * trilha inaudível.
 */
export const TRILHA: Faixa[] = [
  { arquivo: 'trilha.mp3', em: 0, volume: 0.16 },
]

/**
 * Efeitos pontuais. Os arquivos de `sfx/` são gerados por `npm run gerar:sfx` —
 * sintetizados no projeto, e não baixados, porque material de venda com áudio de
 * licença duvidosa é um problema caro por um ganho pequeno.
 */
export const EFEITOS: Faixa[] = [
  // { arquivo: 'sfx/impacto.wav', em: 2.3, volume: 0.7 },   // a bola batendo
  // { arquivo: 'sfx/whoosh.wav', em: 7.0, volume: 0.45 },   // virada para as dores
]

/** Contato que aparece no encerramento. */
export const CONTATO = {
  site: 'arenahub.app',
  instagram: '@arenahub.app',
  chamada: 'Criar conta grátis',
  reforco: '1º mês grátis · sem cartão · pronto em 5 min',
}

/**
 * O Convite. Ele NÃO pede a venda — pede só a permissão de mostrar, que é a
 * única coisa que um vídeo frio consegue arrancar.
 *
 * `trechos` espelha a ordem de CLIPES: um pedaço curto de cada gravação, só para
 * provar que o produto existe e funciona.
 */
export const CONVITE = {
  /**
   * O Convite mostra IMAGENS dentro do celular, não a gravação.
   *
   * Vídeo acelerado num quadro de 40 s vira borrão: o contato não tem tempo de
   * entender nenhuma tela. Print parado, com um rótulo, ele lê inteiro em três
   * segundos. A gravação continua sendo o corpo da Apresentação, onde há tempo.
   *
   * Os arquivos vão em `public/imagens/`, na raiz do repositório.
   */
  imagens: [
    // Rótulos batem com o conteúdo real de cada print (não com o nome do
    // arquivo): a home do admin mostra o DIA, não a semana, por exemplo.
    { arquivo: '01-agenda-semana.png', rotulo: 'O seu dia, numa tela só' },
    { arquivo: '02-chamada.png', rotulo: 'Chamada no celular, na quadra' },
    { arquivo: '03-inadimplencia.png', rotulo: 'Quem está devendo, sem planilha' },
    { arquivo: '04-aluno-reserva.png', rotulo: 'O aluno reserva sozinho' },
    { arquivo: '05-aluno-credito.png', rotulo: 'Créditos e frequência, sempre à mão' },
    { arquivo: '06-liga.png', rotulo: 'Ranking que traz o aluno de volta' },
  ],
  /** Quanto tempo cada imagem fica na tela, em segundos. */
  segundosPorImagem: 3.2,
  /** O fecho. Serve para mandar no WhatsApp e para postar. */
  fecho: {
    linha1: 'Sua arena no automático.',
    linha2: 'Você na quadra, não na planilha.',
    apoio: '1º mês grátis · sem cartão · no ar em 5 minutos',
  },
}

/** 'paisagem' (1920x1080, e-mail/reunião) ou 'retrato' (1080x1920, stories). */
export const FORMATO: 'paisagem' | 'retrato' = 'paisagem'

export const FPS = 30
export const DIMENSOES =
  FORMATO === 'paisagem'
    ? { width: 1920, height: 1080 }
    : { width: 1080, height: 1920 }

/**
 * O Convite é SEMPRE vertical, independente de FORMATO: ele existe para ser
 * aberto no WhatsApp, e em 16:9 ocuparia um terço da tela do celular.
 */
export const DIMENSOES_CONVITE = { width: 1080, height: 1920 }
