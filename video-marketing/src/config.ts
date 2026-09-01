// -----------------------------------------------------------------------------
// A ÚNICA COISA QUE VOCÊ PRECISA EDITAR.
//
// Os vídeos ficam em ../public/videos e o áudio em ../public/audio (ou seja:
// public/ na raiz do repo), porque remotion.config.ts aponta o publicDir para lá.
//
// São DOIS vídeos, com funções diferentes na conversa:
//   Convite       ~40 s, vertical  — acompanha o "oi" no WhatsApp
//   Demo          ~1:50, horizontal — vai depois que a arena responde "manda"
// O porquê dessa divisão está em NARRACAO.md.
// -----------------------------------------------------------------------------

/**
 * As dores do dono da arena, na ordem em que aparecem.
 *
 * Abrem tanto a `Abertura` quanto o `Convite`, ANTES de qualquer marca: em vídeo
 * frio o espectador decide em ~5 s se continua, e logo animado não é motivo para
 * continuar. Elas também são a única coisa na tela que precisa funcionar no mudo,
 * que é como o WhatsApp toca vídeo.
 *
 * Frase curta e concreta ganha de frase esperta. O teste é: o dono da arena lê e
 * pensa "isso é a minha terça-feira".
 */
export const DORES = [
  'Domingo, 22h.',
  'Três alunos te chamando pra remarcar a aula de terça.',
  'E amanhã você ainda não sabe quem faltou, quem pagou e quem está na fila.',
]

export type Parada = {
  /** Segundo do clipe (já cortado e acelerado) em que a imagem congela. */
  em: number
  /** Quanto tempo fica congelada. 1,2 s é o suficiente para ler um rótulo. */
  duracao: number
  /** O rótulo grande que aparece durante a parada. */
  texto: string
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
   * é VERTICAL (celular), que é quando sobra quadro nas laterais. Em gravação de
   * desktop o vídeo ocupa a largura toda e o painel não existe.
   */
  destaques: string[]
  /** Corta o começo do bruto, em SEGUNDOS. 0 = usa desde o início. */
  cortarInicio: number
  /** Corta o fim: segundos a DESCARTAR do final. 0 = vai até o fim. */
  cortarFim: number
  /**
   * Acelera a gravação. 1 = velocidade real, 10 = dez vezes mais rápido.
   * A duração no vídeo final é (bruto - cortes) / velocidade, e a linha do
   * tempo se ajusta sozinha — não há nenhum outro número para mexer.
   * Acima de 1 aparece um selo "10×" no canto, para o cliente não achar que a
   * gravação está travando.
   */
  velocidade: number
  /**
   * Momentos em que a imagem CONGELA com um rótulo grande.
   *
   * É o que salva a gravação acelerada. A 10× ou 20× nenhuma tela fica no ar
   * tempo suficiente para ser lida — o espectador vê movimento, não o produto.
   * Congelar 1,2 s quatro vezes devolve quatro coisas que ele efetivamente vê,
   * sem perder a sensação de volume que a passagem rápida cria.
   *
   * As paradas ALONGAM o clipe (a duração de cada uma entra no total), então
   * quatro paradas de 1,2 s acrescentam ~5 s ao vídeo. Isso é contabilizado
   * sozinho em Root.tsx.
   */
  paradas: Parada[]
  /**
   * Legendas que aparecem por cima do vídeo (lower third).
   * `em` é o segundo no vídeo FINAL — depois do corte de início E depois da
   * aceleração. Com `velocidade: 10`, o minuto 2:00 do bruto cai aos 12 s aqui.
   * O jeito prático de acertar: rode `npm run studio`, arraste a linha do tempo
   * até o momento e leia o segundo que o próprio Studio mostra.
   * Deixe a lista vazia enquanto não souber os tempos — o vídeo roda igual.
   */
  legendas: { em: number; duracao: number; texto: string }[]
}

/**
 * A ORDEM IMPORTA: a arena vem primeiro, o aluno depois.
 *
 * Quem decide a compra é o dono. Começando pelo aluno, ele passa os primeiros
 * 30 s — a janela em que mais gente abandona — vendo tela de alguém que ainda
 * não é problema dele. Invertido, ele vê a própria operação primeiro (o alívio),
 * e a experiência do aluno vira o desfecho: é o que ele vai querer mostrar para
 * os alunos, então é o melhor gancho possível logo antes da chamada final.
 */
export const CLIPES: Clipe[] = [
  {
    arquivo: 'admin.mp4',
    titulo: 'A sua operação',
    subtitulo: 'Grade, chamada, mensalidade e inadimplência num lugar só.',
    indice: '01',
    destaques: [
      'Grade da semana gerada num clique',
      'Chamada no celular, na beira da quadra',
      'Quem está devendo, na tela',
      'Relatório de presença e ocupação',
    ],
    cortarInicio: 0,
    cortarFim: 0,
    // Bruto de ~20 min → ~1 min no vídeo final.
    velocidade: 20,
    // Ajuste `em` no Studio depois de ver o corte: o alvo é congelar numa tela
    // cheia e reconhecível, não no meio de uma navegação.
    paradas: [
      { em: 12, duracao: 1.2, texto: 'A grade da semana, num clique' },
      { em: 26, duracao: 1.2, texto: 'Chamada pelo celular, na quadra' },
      { em: 40, duracao: 1.4, texto: 'Quem está devendo — sem planilha' },
      { em: 52, duracao: 1.2, texto: 'Presença e ocupação de cada turma' },
    ],
    legendas: [],
  },
  {
    arquivo: 'aluno.mp4',
    titulo: 'E o que o seu aluno vê',
    subtitulo: 'Ele reserva, cancela e confirma presença sozinho. Sem te mandar mensagem.',
    indice: '02',
    destaques: [
      'Reserva a aula em dois toques',
      'Cancelou a tempo? O crédito volta sozinho',
      'Fila de espera que chama o próximo automaticamente',
      'Confirma presença na quadra pelo celular',
    ],
    cortarInicio: 0,
    cortarFim: 0,
    // Bruto de ~5 min → ~30 s no vídeo final.
    velocidade: 10,
    paradas: [
      { em: 7, duracao: 1.2, texto: 'Reserva em dois toques' },
      { em: 16, duracao: 1.4, texto: 'Cancelou a tempo? Crédito de volta' },
      { em: 25, duracao: 1.2, texto: 'Fila de espera automática' },
    ],
    legendas: [
      // Atenção: `em` é o segundo no vídeo FINAL (já acelerado), não no bruto.
      // { em: 4, duracao: 3.5, texto: 'Reserva a aula em dois toques' },
    ],
  },
]

/**
 * Faixas de áudio sobrepostas ao vídeo. Os arquivos vão em `public/audio/`.
 *
 * `em` é o segundo do vídeo FINAL em que a faixa começa. Uma narração gravada de
 * uma vez só é uma faixa com `em: 0`; narração por bloco são várias faixas, e é o
 * formato mais fácil de manter — regravar 15 segundos não obriga a regravar tudo,
 * e mudar a `velocidade` de um clipe só desloca as faixas dali para a frente.
 *
 * Deixe a lista vazia para renderizar sem áudio.
 */
export type Faixa = {
  arquivo: string
  em: number
  /** 1 = volume cheio. Música de fundo pede algo entre 0.08 e 0.15. */
  volume: number
}

export const NARRACAO: Faixa[] = [
  // Tempos para o corte padrao. Confira no Studio depois de trocar velocidade,
  // cortes ou paradas — e a linha do tempo que manda. Texto em NARRACAO.md.
  // { arquivo: 'narracao-01-dores.mp3', em: 0.6, volume: 1 },
  // { arquivo: 'narracao-02-arena.mp3', em: 13, volume: 1 },
  // { arquivo: 'narracao-03-aluno.mp3', em: 82, volume: 1 },
  // { arquivo: 'narracao-04-fecho.mp3', em: 113, volume: 1 },
]

/**
 * Música de fundo. Uma faixa com `em: 0` cobrindo o vídeo inteiro é o normal.
 *
 * O volume aqui é o volume QUANDO NINGUÉM ESTÁ FALANDO: enquanto uma faixa de
 * NARRACAO toca, a trilha abaixa sozinha (ver `ducking` em Demo.tsx). Sem isso,
 * volume fixo ou come a voz ou deixa a trilha inaudível.
 */
export const TRILHA: Faixa[] = [
  // { arquivo: 'trilha.mp3', em: 0, volume: 0.16 },
]

/**
 * Efeitos pontuais. Os arquivos de `sfx/` são gerados por `npm run gerar:sfx` —
 * sintetizados no próprio projeto, e não baixados, porque material de venda com
 * áudio de licença duvidosa é um problema caro por um ganho pequeno.
 */
export const EFEITOS: Faixa[] = [
  // { arquivo: 'sfx/impacto.wav', em: 5.0, volume: 0.7 },   // a bola batendo
  // { arquivo: 'sfx/whoosh.wav', em: 9.4, volume: 0.45 },  // virada de bloco
  // { arquivo: 'sfx/sub-drop.wav', em: 28.2, volume: 0.5 }, // entrada da chamada
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
 * `blocos` espelha a ordem de CLIPES: quantos segundos de cada gravação entram
 * na montagem e onde ela congela. A VELOCIDADE não se define aqui — ela é
 * calculada a partir da duração real do arquivo para caber nos `segundos`
 * pedidos, então trocar a gravação por uma mais longa não desregula o convite.
 */
export const CONVITE = {
  pergunta: 'Quer ver por dentro?',
  resposta: 'Respondo com o vídeo completo. 1 minuto e meio.',
  blocos: [
    {
      segundos: 8,
      paradas: [
        { em: 2.5, duracao: 1.2, texto: 'A semana inteira, num clique' },
        { em: 6, duracao: 1.3, texto: 'Quem está devendo — sem planilha' },
      ] as Parada[],
    },
    {
      segundos: 7,
      paradas: [
        { em: 2, duracao: 1.2, texto: 'O aluno reserva sozinho' },
        { em: 5, duracao: 1.3, texto: 'Fila de espera automática' },
      ] as Parada[],
    },
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
