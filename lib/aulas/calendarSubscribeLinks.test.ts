import { describe, it, expect } from 'vitest'
import {
  appleSubscribeUrl,
  googleSubscribeUrl,
  outlookSubscribeUrl,
} from './calendarSubscribeLinks'

const FEED = 'https://arenahub.website/api/calendar/abc123'

describe('appleSubscribeUrl', () => {
  // Sem trocar o esquema, o iPhone abre o link no navegador e só baixa o
  // arquivo — não assina nada.
  it('troca https por webcal para o SO entregar ao app de calendário', () => {
    expect(appleSubscribeUrl(FEED)).toBe('webcal://arenahub.website/api/calendar/abc123')
  })

  it('troca http também (ambiente local)', () => {
    expect(appleSubscribeUrl('http://localhost:3000/api/calendar/x')).toBe(
      'webcal://localhost:3000/api/calendar/x',
    )
  })

  it('não mexe no resto do endereço', () => {
    expect(appleSubscribeUrl(FEED)).toContain('/api/calendar/abc123')
  })
})

describe('googleSubscribeUrl', () => {
  it('leva o feed em webcal, encodado dentro de cid', () => {
    expect(googleSubscribeUrl(FEED)).toBe(
      'https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Farenahub.website%2Fapi%2Fcalendar%2Fabc123',
    )
  })

  // O encode é o ponto todo: sem ele um ? ou & do feed cortaria a URL do
  // Google no meio e o cid chegaria truncado.
  it('escapa caractere que quebraria a query do Google', () => {
    const link = googleSubscribeUrl('https://host/api/calendar/tok?a=1&b=2')
    expect(link).toContain('%3Fa%3D1%26b%3D2')
    // Só existe UM '?' no link final: o do próprio Google.
    expect(link.match(/\?/g)).toHaveLength(1)
  })
})

describe('outlookSubscribeUrl', () => {
  it('manda url e nome, os dois encodados', () => {
    expect(outlookSubscribeUrl(FEED, 'Agenda Arena X')).toBe(
      'https://outlook.live.com/calendar/0/addfromweb?url=webcal%3A%2F%2Farenahub.website%2Fapi%2Fcalendar%2Fabc123&name=Agenda%20Arena%20X',
    )
  })

  it('nome com acento e & não quebra a query', () => {
    const link = outlookSubscribeUrl(FEED, 'Educação & Esporte')
    expect(link).toContain('name=Educa%C3%A7%C3%A3o%20%26%20Esporte')
    expect(link.match(/\?/g)).toHaveLength(1)
  })
})
