// app/(dashboard)/agendar/page.tsx
// A tela de agendar deixou de existir para o aluno.
//
// Ela era uma segunda porta para a mesma agenda, com menos informação: listava as
// turmas da grade sem dizer quem já está na aula nem mostrar a fila de espera, e
// carregava um limite diário fixo em 2 que ignorava a configuração da academia. O
// aluno agora vê tudo na Home — faixa da semana e calendário do mês —, e tocar
// numa aula abre a ficha completa em modal, com entrar, sair e fila.
//
// A rota fica como redirect (mesmo caso de /aulas): há atalhos antigos, PWA
// instalada com a URL salva e `revalidatePath('/agendar')` espalhado pelas
// actions. O day use continua em /agendar/dayuse, que é rota própria.
import { redirect } from 'next/navigation'

export default function AgendarPage() {
  redirect('/home')
}
