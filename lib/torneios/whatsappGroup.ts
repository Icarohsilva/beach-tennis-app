// lib/torneios/whatsappGroup.ts
// Grupo do WhatsApp do torneio. Puro.
//
// O WhatsApp só deixa adicionar ao grupo quem está salvo nos contatos do
// celular. O caminho sem salvar ninguém é o LINK DE CONVITE do grupo
// (chat.whatsapp.com/...): a arena cola o link no torneio e manda para cada
// inscrito por wa.me, que abre a conversa sem o número estar salvo. O
// "Enviar acesso" não serve para isso porque gera senha nova a cada clique.
import type { XlsxSheet } from '@/lib/utils/xlsx'
import { firstName } from './contactMessage'

const INVITE_RE = /^(?:https?:\/\/)?chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]{10,40})\/?(?:\?.*)?$/

/**
 * Normaliza o link de convite colado pela arena para
 * `https://chat.whatsapp.com/<código>`. Devolve null quando não é um convite
 * de grupo: um wa.me de pessoa ou um link de comunidade colado por engano
 * mandaria todos os inscritos para o lugar errado.
 */
export function normalizeGroupInviteUrl(input: string | null | undefined): string | null {
  const raw = (input ?? '').trim()
  if (!raw) return null
  const match = raw.match(INVITE_RE)
  return match ? `https://chat.whatsapp.com/${match[1]}` : null
}

/** Convite que vai para cada inscrito, pelo primeiro nome e pela arena. */
export function buildGroupInviteMessage(ctx: {
  toName: string
  tournamentName: string
  orgName?: string | null
  groupUrl: string
}): string {
  const to = firstName(ctx.toName)
  const from = ctx.orgName?.trim() ? ` Aqui é da ${ctx.orgName.trim()}.` : ''
  return (
    `Oi${to ? `, ${to}` : ''}!${from} Criamos o grupo do torneio ${ctx.tournamentName} ` +
    `para os avisos de horário, chave e resultados. Entra por aqui: ${ctx.groupUrl}`
  )
}

// ---------------------------------------------------------------------------
// Contatos dos inscritos, para baixar de uma vez.
//
// A arena não quer mandar convite um por um. Duas saídas em lote:
//   • planilha (.xlsx): a lista para conferir, encaminhar ou importar;
//   • contatos (.vcf): abrir no celular salva TODOS de uma vez, e aí o WhatsApp
//     deixa adicionar todo mundo direto no grupo.
// ---------------------------------------------------------------------------
export interface TournamentContact {
  name: string
  phone: string | null
  status: 'confirmed' | 'waitlist'
  /** 'paid' | 'pending' | 'free' do lado desta pessoa na inscrição. */
  payment: 'paid' | 'pending' | 'free' | null
}

/** Celular brasileiro em E.164 (+5511999999999), ou null se não for número válido. */
export function phoneToE164(phone: string | null | undefined): string | null {
  let digits = (phone ?? '').replace(/\D/g, '')
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) digits = digits.slice(2)
  if (digits.length !== 10 && digits.length !== 11) return null
  return `+55${digits}`
}

function formatPhone(e164: string): string {
  const d = e164.slice(3)
  const split = d.length === 11 ? 7 : 6
  return `(${d.slice(0, 2)}) ${d.slice(2, split)}-${d.slice(split)}`
}

const STATUS_LABEL: Record<TournamentContact['status'], string> = {
  confirmed: 'Inscrito',
  waitlist: 'Lista de espera',
}
const PAYMENT_LABEL: Record<NonNullable<TournamentContact['payment']>, string> = {
  paid: 'Pago',
  pending: 'Pendente',
  free: 'Gratuito',
}

/** Planilha dos inscritos: inscritos primeiro, depois a fila, por nome. */
export function contactsToSheet(contacts: TournamentContact[]): XlsxSheet {
  const sorted = [...contacts].sort(
    (a, b) => Number(a.status !== 'confirmed') - Number(b.status !== 'confirmed') || a.name.localeCompare(b.name, 'pt-BR'),
  )
  return {
    name: 'Inscritos',
    columns: [
      { header: 'Nome', width: 36 },
      { header: 'WhatsApp', width: 18 },
      { header: 'Número (com 55)', width: 18 },
      { header: 'Situação', width: 16 },
      { header: 'Pagamento', width: 12, align: 'center' },
    ],
    rows: sorted.map((c) => {
      const e164 = phoneToE164(c.phone)
      return [
        c.name,
        e164 ? formatPhone(e164) : 'SEM WHATSAPP',
        e164 ? e164.slice(1) : null,
        STATUS_LABEL[c.status],
        c.payment ? PAYMENT_LABEL[c.payment] : null,
      ]
    }),
  }
}

function vcardEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1')
}

/**
 * Prefixo do nome de cada contato importado. Pedido da arena: buscar "ArenaHub"
 * na agenda mostra todos os atletas de uma vez na hora de adicionar ao grupo, e
 * separa quem veio do app de quem já estava salvo no celular.
 */
export const CONTACT_NAME_PREFIX = 'ArenaHub'

/**
 * Arquivo de contatos (vCard 3.0) só com os INSCRITOS que têm WhatsApp: é quem
 * vai para o grupo. O nome sai como "ArenaHub Ana Lima"; o torneio vai em ORG,
 * para não alongar o nome que aparece no WhatsApp.
 */
export function contactsToVcard(contacts: TournamentContact[], tournamentName: string): string {
  const seen = new Set<string>()
  const cards: string[] = []
  for (const c of contacts) {
    if (c.status !== 'confirmed') continue
    const e164 = phoneToE164(c.phone)
    if (!e164 || seen.has(e164)) continue
    seen.add(e164)
    const name = vcardEscape(`${CONTACT_NAME_PREFIX} ${c.name.trim() || 'Atleta'}`)
    cards.push(
      [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `FN:${name}`,
        `N:;${name};;;`,
        `TEL;TYPE=CELL:${e164}`,
        `ORG:${vcardEscape(tournamentName)}`,
        'END:VCARD',
      ].join('\r\n'),
    )
  }
  return cards.length ? `${cards.join('\r\n')}\r\n` : ''
}
