// Tudo que você troca sem mexer no desenho.
// Depois de editar, rode:  npm run build

module.exports = {
  // --- Contato (PREENCHA O WHATSAPP ANTES DE MANDAR PRA GRÁFICA) ---
  whatsapp: '(31) 9 0000-0000',
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
  qrCriar: 'https://arenahub.website/criar-academia',

  // --- Oferta ---
  preco: 'R$ 49,90',
  precoUnidade: '/mês',
  garantias: ['alunos ilimitados', 'sem taxa por aluno', '1º mês grátis'],

  // --- Numeração do convite ---
  // Deixe `null` para imprimir a linha em branco e escrever à mão (recomendado:
  // manuscrito converte mais em outbound 1-a-1 e não exige dado variável).
  totalConvites: 60,

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
