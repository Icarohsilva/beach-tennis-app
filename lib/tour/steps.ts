import type { TourVariant } from './autostart'

export interface TourStep {
  element?: string
  popover: { title: string; description: string }
}

const ALUNO_STEPS: TourStep[] = [
  {
    popover: {
      title: 'Bem-vindo(a)! 👋',
      description: 'Esse é o seu painel. Vou te mostrar rapidinho como tudo funciona.',
    },
  },
  {
    element: '[data-tour="tour-aluno-arena"]',
    popover: {
      title: 'Arena',
      description:
        'Aqui ficam os torneios da sua academia e o Day Use (aluguel de quadra avulsa). Para agendar sua aula, use o botão laranja "+" no centro.',
    },
  },
  {
    element: '[data-tour="tour-aluno-progresso"]',
    popover: {
      title: 'Seu progresso',
      description: 'Acompanhe aqui seus créditos, aulas na semana e seu nível.',
    },
  },
  {
    element: '[data-tour="tour-aluno-perfil"]',
    popover: {
      title: 'Perfil e ajuda',
      description:
        'Seus dados ficam no Perfil. E sempre que precisar, o botão de ajuda (?) reabre este tutorial e mostra as perguntas frequentes.',
    },
  },
]

const ADMIN_STEPS: TourStep[] = [
  {
    element: '[data-tour="tour-admin-dashboard"]',
    popover: {
      title: 'Painel administrativo',
      description: 'A Dashboard traz a visão geral dos números da sua academia.',
    },
  },
  {
    element: '[data-tour="tour-admin-cadastro"]',
    popover: {
      title: 'Cadastros',
      description: 'Em Alunos e Grade de Aulas você cadastra novos alunos e monta as turmas.',
    },
  },
  {
    element: '[data-tour="tour-admin-torneios"]',
    popover: {
      title: 'Torneios',
      description: 'Crie e gerencie torneios da sua academia por aqui.',
    },
  },
  {
    element: '[data-tour="tour-admin-financeiro"]',
    popover: {
      title: 'Relatórios e faturamento',
      description: 'Acompanhe receitas, pagamentos e relatórios no Financeiro.',
    },
  },
  {
    element: '[data-tour="tour-admin-config"]',
    popover: {
      title: 'Configurações',
      description: 'Ajuste as configurações gerais do sistema sempre que precisar.',
    },
  },
]

export function getTourSteps(variant: TourVariant): TourStep[] {
  return variant === 'aluno' ? ALUNO_STEPS : ADMIN_STEPS
}
