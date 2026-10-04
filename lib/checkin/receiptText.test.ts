import { describe, it, expect } from 'vitest'
import { hasCardDate, parseReceiptText } from './receiptText'

// Saídas REAIS do Tesseract sobre um print de "Check-in confirmado" do Wellhub
// (imagem invertida e original). Os erros de leitura são o ponto do teste.
const INVERTIDA = `wellhub 7º x
[D) DD)
Checlctin confirmado
ÊR Varandas Beach
F Futevôlei
fm Av. Nossa Sra. da Conceição, 481 - Centro...
O 11h38 + 4 out
ez Exibir código`

const ORIGINAL = `11:38 56 E
ÊR Varandas Beach
sic o Futevôlei
Av. Nossa Sra. da Conceição, 481 - Centro...
11h38 + 4 out
tn: Exibir código`

describe('parseReceiptText', () => {
  it('lê a tela invertida: título, academia, data e hora do cartão', () => {
    expect(parseReceiptText(INVERTIDA)).toMatchObject({
      isWellhubCheckin: true, day: 4, month: 10, hour: 11, minute: 38,
    })
  })

  it('sem o título na leitura, não confirma que é a tela de check-in', () => {
    // A passada na imagem original perde o título branco sobre o rosa.
    const r = parseReceiptText(ORIGINAL)
    expect(r).toMatchObject({ day: 4, month: 10, hour: 11, minute: 38 })
    expect(r.isWellhubCheckin).toBe(false)
  })

  it('aceita as variações do separador e do mês', () => {
    for (const t of ['confirmado 9h05 • 12 dez', 'confirmado 9h05·12 dez', 'confirmado 9 h 05 - 12 de dez', 'confirmado 9h05 12 dez']) {
      expect(parseReceiptText(t)).toMatchObject({ hour: 9, minute: 5, day: 12, month: 12 })
    }
    expect(parseReceiptText('confirmado 18h20 + 3 0ut')).toMatchObject({ month: 10 })
  })

  it('não confunde o relógio da barra de status com a hora do check-in', () => {
    const r = parseReceiptText('wellhub 11:38 Check-in confirmado')
    expect(r.month).toBeNull()
    expect(r.isWellhubCheckin).toBe(false)
  })

  it('logo do Wellhub sem cartão de check-in não vale', () => {
    expect(parseReceiptText('wellhub Encontre academias perto de você').isWellhubCheckin).toBe(false)
  })
})

describe('hasCardDate', () => {
  it('diz se vale tentar outra passada de OCR', () => {
    expect(hasCardDate(INVERTIDA)).toBe(true)
    expect(hasCardDate('Checlctin confirmado')).toBe(false)
  })
})
