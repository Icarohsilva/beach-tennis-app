// Tudo que você troca sem mexer no desenho.
// Depois de editar, rode:  npm run build

module.exports = {
  // --- Contato ---
  whatsapp: '(31) 99631-3913',
  site: 'arenahub.website',
  instagram: '@arenahub.app',
  fundador: 'Ícaro Silva',
  primeiroNome: 'Ícaro',
  cidade: 'Belo Horizonte',
  ano: '2026',

  // --- Destinos dos QR codes ---
  // qrInstagram fica na contracapa (o que a galera escaneia no balcão).
  // qrCriar fica na parte interna (a ação de quem decidiu).
  qrInstagram: 'https://www.instagram.com/arenahub.app/',

  // O QR do WhatsApp abre a conversa com a mensagem JÁ ESCRITA, dizendo de qual
  // arena veio. Resolve duas coisas de uma vez: tira o atrito de quem não sabe o
  // que escrever, e diz para você exatamente qual convite gerou o contato, que é
  // a medição que o link direto do Instagram não dá.
  whatsappE164: '5531996313913',
  // Curta de propósito: cada caractere aqui vira módulo no QR, e módulo pequeno
  // demais não lê no papel.
  mensagemConvite: (arena) =>
    arena ? `Oi! Aqui é da ${arena}. Recebi o convite.` : 'Oi! Recebi o convite do ArenaHub.',
  qrCriar: 'https://arenahub.website/criar-academia',

  // --- Oferta ---
  preco: 'R$ 49,90',
  precoUnidade: '/mês',
  garantias: ['alunos ilimitados', 'sem taxa por aluno', '1º mês grátis', 'suporte vitalício no WhatsApp'],

  // --- Arenas do lote atual ---
  // O nome vai impresso na capa. Gera-se sob demanda, em lotes pequenos, para
  // imprimir só o que vai ser entregue naquela semana.
  arenas: [
    'Aloha Beach',
    'Varandas Beach',
    'Arena Numar',
    'Arena Fahel',
    'Arena Meritus',
  ],

  // --- Fichas de produção geradas para a gráfica ---
  // A prova pequena sai sem soft touch e sem verniz localizado: são acabamentos
  // com custo de preparação, e em 3 unidades custam mais que a tiragem inteira
  // da versão simples.
  fichas: [
    { nome: 'ArenaHub-Ficha-Grafica-PROVA-3un.png', tiragem: 3, acabamentoCompleto: false },
    { nome: 'ArenaHub-Ficha-Grafica-150un.png', tiragem: 150, acabamentoCompleto: true },
  ],


  // --- Paleta (idêntica ao app) ---
  cor: {
    fundo: '#0c1220',
    card: '#151e31',
    borda: '#26334d',
    laranja: '#f97316',
    laranjaEscuro: '#ea580c',
    laranjaProfundo: '#9a3412',
    texto: '#ffffff',
    suave: '#94a3b8',
    claro: '#f8fafc',
  },

  // --- Medidas do impresso (mm) ---
  print: {
    fechado: 150, // quadrado 150 × 150 mm
    aberto: 300, // 300 × 150 mm
    altura: 150,
    sangria: 3,
    marcaFolga: 10, // área extra para marcas de corte e barra de informação
  },
}
