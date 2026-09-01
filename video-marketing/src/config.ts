// -----------------------------------------------------------------------------
// A ÚNICA COISA QUE VOCÊ PRECISA EDITAR.
//
// Os vídeos ficam em ../public/videos (ou seja: public/videos na raiz do repo),
// porque remotion.config.ts aponta o publicDir para lá.
// -----------------------------------------------------------------------------

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
   * Legendas que aparecem por cima do vídeo (lower third).
   * `em` é em segundos, contados DEPOIS do corte de início.
   * Deixe a lista vazia enquanto não souber os tempos — o vídeo roda igual.
   */
  legendas: { em: number; duracao: number; texto: string }[]
}

export const CLIPES: Clipe[] = [
  {
    arquivo: 'aluno.mp4',
    titulo: 'A experiência do aluno',
    subtitulo: 'Ele reserva, cancela e confirma presença sozinho. Sem te mandar mensagem.',
    indice: '01',
    destaques: [
      'Reserva a aula em dois toques',
      'Cancelou a tempo? O crédito volta sozinho',
      'Fila de espera que chama o próximo automaticamente',
      'Confirma presença na quadra pelo celular',
    ],
    cortarInicio: 0,
    cortarFim: 0,
    legendas: [
      // { em: 4, duracao: 3.5, texto: 'Reserva a aula em dois toques' },
      // { em: 12, duracao: 3.5, texto: 'Cancelou a tempo? O crédito volta na hora' },
    ],
  },
  {
    arquivo: 'admin.mp4',
    titulo: 'O painel da arena',
    subtitulo: 'Chamada, grade, mensalidade e inadimplência num lugar só.',
    indice: '02',
    destaques: [
      'Chamada da aula sem caderninho',
      'Grade da semana gerada num clique',
      'Quem está devendo, na tela',
      'Relatório de presença e ocupação',
    ],
    cortarInicio: 0,
    cortarFim: 0,
    legendas: [],
  },
]

/** Contato que aparece no encerramento. */
export const CONTATO = {
  site: 'arenahub.app',
  instagram: '@arenahub.app',
  chamada: 'Criar conta grátis',
  reforco: '1º mês grátis · sem cartão · pronto em 5 min',
}

/** 'paisagem' (1920x1080, WhatsApp/e-mail/reunião) ou 'retrato' (1080x1920, stories). */
export const FORMATO: 'paisagem' | 'retrato' = 'paisagem'

export const FPS = 30
export const DIMENSOES =
  FORMATO === 'paisagem'
    ? { width: 1920, height: 1080 }
    : { width: 1080, height: 1920 }
