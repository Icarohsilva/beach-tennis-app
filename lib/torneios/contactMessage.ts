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
