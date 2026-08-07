import type { TourVariant } from './autostart'

export interface Faq {
  q: string
  a: string
}

const ALUNO_FAQS: Faq[] = [
  {
    q: 'Como agendar uma aula?',
    a: 'Toque no botão laranja "+" no centro da barra inferior, escolha o dia e a turma disponível e confirme a reserva.',
  },
  {
    q: 'Como cancelar e recuperar meu crédito?',
    a: 'Cancelamentos feitos até 5 horas antes da aula devolvem o crédito automaticamente. Após esse prazo, o crédito não é devolvido.',
  },
  {
    q: 'Como altero minha senha?',
    a: 'Vá em Perfil e use a opção de alterar senha. Se esqueceu a senha, use "Recuperar senha" na tela de login.',
  },
  {
    q: 'O que significam os níveis (iniciante, D, C, B, A)?',
    a: 'É a hierarquia de nível técnico, do iniciante ao A (mais avançado). Você só consegue reservar aulas do seu nível ou abaixo dele.',
  },
  {
    q: 'Como funciona o check-in via Wellhub/TotalPass?',
    a: 'Se você usa Wellhub ou TotalPass, o check-in é registrado automaticamente pelo parceiro. Você não precisa fazer nada manual no app.',
  },
]

const ADMIN_FAQS: Faq[] = [
  {
    q: 'Como cadastrar um novo aluno?',
    a: 'Acesse Alunos no menu lateral e use o botão de cadastrar. Você também pode gerar um link de convite para o aluno se cadastrar sozinho.',
  },
  {
    q: 'Como criar uma turma na grade?',
    a: 'Vá em Grade de Aulas e use "Nova turma". Defina dia, horário, nível e capacidade. As sessões datadas são geradas a partir desse modelo.',
  },
  {
    q: 'Como criar um torneio?',
    a: 'Acesse Torneios no menu lateral e crie um novo torneio, definindo formato, datas e inscrições.',
  },
  {
    q: 'Onde vejo o faturamento?',
    a: 'Em Financeiro você acompanha receitas, pagamentos e relatórios da academia.',
  },
  {
    q: 'Como altero minha senha?',
    a: 'Use a opção de alterar senha no seu perfil. Para redefinir sem estar logado, use "Recuperar senha" na tela de login.',
  },
]

export function getFaqs(variant: TourVariant): Faq[] {
  return variant === 'aluno' ? ALUNO_FAQS : ADMIN_FAQS
}
