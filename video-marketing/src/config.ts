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

/**
 * Um pedaço da gravação que entra no vídeo.
 *
 * O vídeo é montado a partir de TRECHOS escolhidos, e não da gravação inteira
 * acelerada. Dois motivos, e os dois vieram de tentar o contrário:
 *
 * 1. Comprimir 20 min em 1 min exige 20×, e a 20× nenhuma tela fica no ar tempo
 *    suficiente para ser vista — vira movimento colorido, não produto.
 * 2. Acima de 16× o navegador recusa (`NotSupportedError`), e a alternativa de
 *    saltar quadro a quadro faz o Studio buscar posição nova 30 vezes por
 *    segundo num arquivo longo: a busca nunca termina e a tela fica PRETA.
 *
 * Dois a quatro trechos por gravação, cada um de 40-70 s a 2-4×, dão um vídeo
 * que corre solto e no qual dá para ver o que está acontecendo.
 */
export type Trecho = {
  /** Segundo do BRUTO em que o trecho começa. */
  de: number
  /** Segundo do BRUTO em que termina. */
  ate: number
  /** Quantas vezes mais rápido. 1 = tempo real. Acima de 4 já fica difícil de ler. */
  velocidade: number
}

export type Clipe = {
  /** Nome do arquivo dentro de public/videos */
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
   * Os pedaços da gravação que entram, em ordem. Cortes secos entre eles.
   *
   * ESTES SÃO OS NÚMEROS QUE VALE A PENA VOCÊ AJUSTAR: abra a gravação, ache os
   * momentos que vendem e anote os segundos. É o que separa uma demonstração de
   * uma gravação de tela acelerada.
   */
  trechos: Trecho[]
  /**
   * Legendas por cima do vídeo (lower third). `em` é o segundo dentro do bloco
   * já montado, não do bruto. Opcional — a narração costuma bastar.
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
    // ~60 s de vídeo montado a partir de 3 momentos da gravação de 20 min.
    // AJUSTE os `de`/`ate` olhando a sua gravação — os valores abaixo são chute.
    trechos: [
      { de: 0, ate: 70, velocidade: 3 },
      { de: 300, ate: 370, velocidade: 3 },
      { de: 900, ate: 970, velocidade: 3 },
    ],
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
    // ~34 s a partir de 2 momentos da gravação de 5 min.
    trechos: [
      { de: 0, ate: 50, velocidade: 3 },
      { de: 150, ate: 200, velocidade: 3 },
    ],
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
  // { arquivo: 'convite-01.mp3', em: 0.8, volume: 1 },   // apresentação
  // { arquivo: 'convite-02.mp3', em: 7, volume: 1 },     // as dores
  // { arquivo: 'convite-03.mp3', em: 14, volume: 1 },    // a arena
  // { arquivo: 'convite-04.mp3', em: 25, volume: 1 },    // o aluno
  // { arquivo: 'convite-05.mp3', em: 34.5, volume: 1 },  // a chamada
]

/** Narração da APRESENTAÇÃO. Tempos em NARRACAO.md. */
export const NARRACAO_DEMO: Faixa[] = [
  // { arquivo: 'narracao-01-abertura.mp3', em: 0.8, volume: 1 },
  // { arquivo: 'narracao-02-dores.mp3', em: 7, volume: 1 },
  // { arquivo: 'narracao-03-arena.mp3', em: 18, volume: 1 },
  // { arquivo: 'narracao-04-aluno.mp3', em: 89, volume: 1 },
  // { arquivo: 'narracao-05-fecho.mp3', em: 121, volume: 1 },
]

/**
 * Música de fundo, uma faixa com `em: 0` cobrindo o vídeo inteiro.
 *
 * O volume aqui é o volume QUANDO NINGUÉM ESTÁ FALANDO: enquanto a narração
 * toca, a trilha abaixa sozinha. Sem isso, volume fixo ou come a voz ou deixa a
 * trilha inaudível.
 */
export const TRILHA: Faixa[] = [
  // { arquivo: 'trilha.mp3', em: 0, volume: 0.16 },
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
  pergunta: 'Quer ver por dentro?',
  resposta: 'Respondo com o vídeo completo. 2 minutos.',
  trechos: [
    [{ de: 0, ate: 36, velocidade: 3 }] as Trecho[], // arena — 12 s
    [{ de: 0, ate: 30, velocidade: 3 }] as Trecho[], // aluno — 10 s
  ],
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
