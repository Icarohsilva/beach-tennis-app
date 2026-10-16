import { describe, it, expect } from 'vitest'
import { buildXlsx, colName, crc32, excelSerial, type XlsxSheet } from './xlsx'

/**
 * Leitor de ZIP mínimo, pelo diretório central — o caminho que Excel e Sheets
 * usam. Independente do gravador: se os offsets ou tamanhos estiverem errados,
 * é aqui que o teste quebra, e não no celular do admin.
 */
function unzip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = bytes.length - 22
  expect(view.getUint32(eocd, true)).toBe(0x06054b50)
  const count = view.getUint16(eocd + 10, true)
  let at = view.getUint32(eocd + 16, true)
  const dec = new TextDecoder()
  const files = new Map<string, string>()
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50)
    const crc = view.getUint32(at + 16, true)
    const size = view.getUint32(at + 20, true)
    const nameLen = view.getUint16(at + 28, true)
    const localAt = view.getUint32(at + 42, true)
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen))

    expect(view.getUint32(localAt, true)).toBe(0x04034b50)
    const localNameLen = view.getUint16(localAt + 26, true)
    const dataAt = localAt + 30 + localNameLen
    const data = bytes.subarray(dataAt, dataAt + size)
    expect(crc32(data), `CRC de ${name}`).toBe(crc)
    files.set(name, dec.decode(data))
    at += 46 + nameLen
  }
  return files
}

const SHEET: XlsxSheet = {
  name: 'Confrontos',
  columns: [
    { header: 'Rodada', width: 18 },
    { header: 'Jogo', align: 'center' },
    { header: 'Data e hora' },
    { header: 'Dupla 1', width: 42 },
  ],
  rows: [
    ['Rodada 1', 1, { dateTime: '2026-09-12T14:30' }, 'Ícaro Silva / Danielle da Silva Oliveira'],
    ['Rodada 1', 2, null, 'A definir'],
  ],
}

describe('crc32', () => {
  it('bate com o valor de verificação padrão do CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
})

describe('colName', () => {
  it('conta colunas como o Excel', () => {
    expect(colName(0)).toBe('A')
    expect(colName(7)).toBe('H')
    expect(colName(25)).toBe('Z')
    expect(colName(26)).toBe('AA')
    expect(colName(701)).toBe('ZZ')
    expect(colName(702)).toBe('AAA')
  })
})

describe('excelSerial', () => {
  it('converte o relógio de parede para o número de série do Excel', () => {
    // 12/09/2026 = dia 46277 do Excel; 14:30 = 0,6041666...
    expect(excelSerial('2026-09-12T14:30')).toBeCloseTo(46277 + 14.5 / 24, 10)
    expect(excelSerial('1970-01-01')).toBe(25569)
  })

  it('recusa o que não é data', () => {
    expect(excelSerial('')).toBeNull()
    expect(excelSerial('12/09/2026')).toBeNull()
  })
})

describe('buildXlsx', () => {
  const files = unzip(buildXlsx(SHEET))

  it('tem as partes mínimas de um pacote OOXML', () => {
    expect(Array.from(files.keys())).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ])
  })

  it('cabeçalho na linha 1 e dados a partir da 2, com texto e número tipados', () => {
    const sheet = files.get('xl/worksheets/sheet1.xml')!
    expect(sheet).toContain('<row r="1"><c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Rodada</t></is></c>')
    // Coluna centralizada leva o estilo de cabeçalho centralizado.
    expect(sheet).toContain('<c r="B1" t="inlineStr" s="4">')
    expect(sheet).toContain('<c r="B2" s="3"><v>1</v></c>')
    expect(sheet).toContain('<t xml:space="preserve">Ícaro Silva / Danielle da Silva Oliveira</t>')
  })

  it('data vira número de série com o formato dia/mês, não texto', () => {
    const sheet = files.get('xl/worksheets/sheet1.xml')!
    expect(sheet).toMatch(/<c r="C2" s="2"><v>46277\.604166666\d*<\/v><\/c>/)
    expect(files.get('xl/styles.xml')).toContain('formatCode="dd/mm/yyyy hh:mm"')
  })

  it('célula vazia não é escrita', () => {
    expect(files.get('xl/worksheets/sheet1.xml')).not.toContain('r="C3"')
  })

  it('trava o cabeçalho e liga o filtro sobre a tabela inteira', () => {
    const sheet = files.get('xl/worksheets/sheet1.xml')!
    expect(sheet).toContain('state="frozen"')
    expect(sheet).toContain('<autoFilter ref="A1:D3"/>')
    expect(files.get('xl/workbook.xml')).toContain(
      `<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'Confrontos'!$A$1:$D$3</definedName>`,
    )
  })

  it('larguras só nas colunas que pediram', () => {
    const sheet = files.get('xl/worksheets/sheet1.xml')!
    expect(sheet).toContain('<cols><col min="1" max="1" width="18" customWidth="1"/><col min="4" max="4" width="42" customWidth="1"/></cols>')
  })

  it('escapa XML e descarta caractere de controle que o Excel recusaria', () => {
    const out = unzip(
      buildXlsx({ name: 'X', columns: [{ header: 'Nome' }], rows: [['Ana & "Bia" <B>\u0007']] }),
    )
    expect(out.get('xl/worksheets/sheet1.xml')).toContain(
      '<t xml:space="preserve">Ana &amp; &quot;Bia&quot; &lt;B&gt;</t>',
    )
  })

  it('nome de aba inválido para o Excel é limpo e cortado em 31', () => {
    const out = unzip(
      buildXlsx({ name: 'Super 8: Feminino/Masculino [B] — Caiçara Beach', columns: [{ header: 'A' }], rows: [] }),
    )
    const wb = out.get('xl/workbook.xml')!
    const name = /<sheet name="([^"]*)"/.exec(wb)![1]
    expect(name.length).toBeLessThanOrEqual(31)
    expect(name).not.toMatch(/[[\]:*?/\\]/)
  })

  it('mesmo conteúdo, mesmos bytes', () => {
    expect(buildXlsx(SHEET)).toEqual(buildXlsx(SHEET))
  })
})
