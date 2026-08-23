// lib/aulas/calendarSubscribeLinks.ts
// Os links que abrem a tela de "assinar esta agenda" já pronta em cada app de
// calendário — o atalho que substitui o copiar-colar.
//
// Sem isto o aluno recebia a URL crua do feed e tinha que achar sozinho, no app
// dele, o menu de "adicionar agenda por URL" (4-5 passos fora do nosso app, no
// celular). Os três provedores aceitam um link que faz esse caminho por ele.
//
// Puro e testado porque errar o encoding aqui falha calado na casa do aluno: o
// app de calendário só diz "não foi possível assinar", sem dizer por quê.

/**
 * `webcal://` é o mesmo endereço do feed com outro esquema. É o que faz o
 * sistema operacional entregar o link ao app de calendário em vez de abrir no
 * navegador (que só baixaria o arquivo, sem assinar nada).
 */
function toWebcal(feedUrl: string): string {
  return feedUrl.replace(/^https?:\/\//i, 'webcal://')
}

/** Apple (iOS/macOS): o próprio `webcal://` abre o Calendário pedindo confirmação. */
export function appleSubscribeUrl(feedUrl: string): string {
  return toWebcal(feedUrl)
}

/**
 * Google Agenda: `cid` recebe o endereço do feed inteiro como UM parâmetro, o
 * que exige encode — sem ele, o `?`/`&` do próprio feed cortaria a URL do
 * Google no meio e o parâmetro chegaria truncado.
 */
export function googleSubscribeUrl(feedUrl: string): string {
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(toWebcal(feedUrl))}`
}

/** Outlook.com: além da URL, aceita o nome com que a agenda aparece na lista. */
export function outlookSubscribeUrl(feedUrl: string, calendarName: string): string {
  const url = encodeURIComponent(toWebcal(feedUrl))
  const name = encodeURIComponent(calendarName)
  return `https://outlook.live.com/calendar/0/addfromweb?url=${url}&name=${name}`
}
