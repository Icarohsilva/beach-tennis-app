// lib/torneios/contactMessage.ts
// A mensagem que já vai escrita no WhatsApp.
//
// Abrir a conversa em branco transfere para quem clicou o trabalho de explicar
// quem é e de onde tirou o número — e é justamente aí que a pessoa desiste. O
// texto pronto se apresenta e diz o contexto (o torneio), que é o que torna o
// contato esperado em vez de estranho.
//
// Puro: quem monta a URL é buildWhatsAppUrl (lib/utils/whatsappLink.ts).

/** Só o primeiro nome — "Oi, Ana Carolina Prado da Silva!" soa a cobrança. */
export function firstName(fullName: string | null | undefined): string {
  const clean = (fullName ?? '').trim()
  if (!clean) return ''
  return clean.split(/\s+/)[0]
}

export interface ContactContext {
  /** Nome de quem vai receber a mensagem. */
  toName: string
  /** Nome de quem está mandando. Vazio no contato da academia. */
  fromName?: string | null
  tournamentName: string
  orgName?: string | null
  /** Quem manda é o organizador, não outro participante. */
  fromAdmin?: boolean
}

/**
 * Texto pré-preenchido da conversa.
 *
 * O organizador se apresenta pela ACADEMIA (é assim que o aluno o reconhece);
 * o participante se apresenta pelo próprio nome e cita o torneio, que é o
 * vínculo entre os dois.
 */
export function buildContactMessage(ctx: ContactContext): string {
  const to = firstName(ctx.toName)
  const greeting = to ? `Oi, ${to}!` : 'Oi!'

  if (ctx.fromAdmin) {
    const from = ctx.orgName?.trim()
    const who = from ? ` Aqui é da ${from}` : ' Aqui é da organização'
    return `${greeting}${who}, sobre o torneio ${ctx.tournamentName}.`
  }

  // Sem nome de quem manda a apresentação não se sustenta ("Sou, do torneio…"),
  // então o texto cai para o contexto puro em vez de sair quebrado.
  const from = firstName(ctx.fromName)
  return from
    ? `${greeting} Sou ${from}, do torneio ${ctx.tournamentName}.`
    : `${greeting} Sobre o torneio ${ctx.tournamentName}.`
}

// --- Acesso ao app -----------------------------------------------------------

export interface AccessContext {
  toName: string
  tournamentName: string
  /** Link público do torneio. */
  tournamentUrl: string
  /** Login da pessoa. */
  email: string
  /**
   * Senha temporária recém-gerada. Ausente quando o admin só reenvia o link a
   * quem já tem senha — mandar "sua senha é ___" sem senha nova seria mentira.
   */
  password?: string | null
  orgName?: string | null
}

/**
 * A mensagem que o organizador manda para quem ele inscreveu na mão.
 *
 * A pessoa não pediu conta nenhuma: ela deu o nome na beira da quadra e alguém
 * digitou por ela. Então o texto precisa responder, em ordem, o que ela vai
 * perguntar: quem está falando, em que torneio ela entrou, onde vê isso, e como
 * entra. Sem o "como entra", o link cai numa tela de login e a inscrição morre ali.
 *
 * A senha temporária vai no texto de propósito: ela só serve para o primeiro
 * acesso — `must_change_password` obriga a trocar antes de o app abrir.
 */
export function buildAccessMessage(ctx: AccessContext): string {
  const to = firstName(ctx.toName)
  const org = ctx.orgName?.trim()
  const linhas: string[] = [
    to ? `Oi, ${to}!` : 'Oi!',
    '',
    org
      ? `Sua inscrição no torneio *${ctx.tournamentName}* (${org}) está confirmada. 🎾`
      : `Sua inscrição no torneio *${ctx.tournamentName}* está confirmada. 🎾`,
    '',
    'Acompanhe a chave, seus jogos e os resultados por aqui:',
    ctx.tournamentUrl,
  ]

  if (ctx.password) {
    linhas.push(
      '',
      'Criamos seu acesso:',
      `E-mail: ${ctx.email}`,
      `Senha provisória: ${ctx.password}`,
      '',
      'No primeiro login o app pede para você criar sua própria senha.',
    )
  } else {
    linhas.push(
      '',
      `Entre com o e-mail ${ctx.email}. Se não lembrar a senha, use "Esqueci minha senha" na tela de login.`,
    )
  }

  return linhas.join('\n')
}
