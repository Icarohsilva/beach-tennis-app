// lib/utils/xlsx.ts
// Planilha .xlsx de uma aba só, sem dependência.
//
// Por que não CSV (que é como `shirtRowsToCsv` exporta): o CSV com `;` e BOM só
// abre direito no Excel pt-BR de computador. No celular — de onde o admin
// exporta na beira da quadra — Google Sheets e Excel mobile leem vírgula, e a
// planilha inteira cai numa coluna só. O .xlsx abre igual em qualquer app.
//
// O arquivo é um ZIP com as partes mínimas do OOXML, gravado sem compressão
// (método STORE, permitido pelo OPC): a planilha tem poucos KB e assim não
// precisamos de deflate. Cabeçalho em negrito, travado no topo e com filtro.

export type XlsxCell =
  | string
  | number
  | null
  /** Relógio de parede "YYYY-MM-DDTHH:mm", sem fuso — o Excel não guarda fuso. */
  | { dateTime: string }

export interface XlsxColumn {
  header: string
  /** Largura em caracteres (a unidade do Excel). */
  width?: number
  align?: 'center'
}

export interface XlsxSheet {
  name: string
  columns: XlsxColumn[]
  rows: XlsxCell[][]
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// Índices em <cellXfs> de STYLES.
const STYLE = { header: 1, dateTime: 2, center: 3, headerCenter: 4 } as const

export function buildXlsx(sheet: XlsxSheet): Uint8Array<ArrayBuffer> {
  const name = sheetName(sheet.name)
  const lastCol = colName(Math.max(sheet.columns.length, 1) - 1)
  const lastRow = sheet.rows.length + 1
  const range = `$A$1:$${lastCol}$${lastRow}`

  const enc = new TextEncoder()
  return zipStore([
    { name: '[Content_Types].xml', data: enc.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: enc.encode(ROOT_RELS) },
    { name: 'xl/workbook.xml', data: enc.encode(workbookXml(name, range)) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(WORKBOOK_RELS) },
    { name: 'xl/styles.xml', data: enc.encode(STYLES) },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(worksheetXml(sheet, range.replace(/\$/g, ''))) },
  ])
}

// --- Partes do OOXML ---------------------------------------------------------

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'

const CONTENT_TYPES =
  XML_HEAD +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  '</Types>'

const ROOT_RELS =
  XML_HEAD +
  `<Relationships xmlns="${NS_PKG_REL}">` +
  `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>` +
  '</Relationships>'

const WORKBOOK_RELS =
  XML_HEAD +
  `<Relationships xmlns="${NS_PKG_REL}">` +
  `<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
  `<Relationship Id="rId2" Type="${NS_REL}/styles" Target="styles.xml"/>` +
  '</Relationships>'

// numFmt 164 é explícito em vez do embutido 22: o 22 é renderizado conforme o
// app (Sheets em inglês mostraria mês/dia), o 164 é sempre dia/mês.
const STYLES =
  XML_HEAD +
  `<styleSheet xmlns="${NS_MAIN}">` +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/></numFmts>' +
  '<fonts count="2">' +
  '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="11"/><color rgb="FF7C2D12"/><name val="Calibri"/><family val="2"/></font>' +
  '</fonts>' +
  '<fills count="3">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFFFEDD5"/><bgColor indexed="64"/></patternFill></fill>' +
  '</fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="5">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>'

function workbookXml(name: string, range: string): string {
  // O nome definido do filtro é o que o próprio Excel grava junto do
  // <autoFilter>; sem ele alguns leitores ignoram o filtro.
  const ref = `'${name.replace(/'/g, "''")}'!${range}`
  return (
    XML_HEAD +
    `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    '<bookViews><workbookView/></bookViews>' +
    `<sheets><sheet name="${esc(name)}" sheetId="1" r:id="rId1"/></sheets>` +
    `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${esc(ref)}</definedName></definedNames>` +
    '</workbook>'
  )
}

function worksheetXml(sheet: XlsxSheet, range: string): string {
  const cols = sheet.columns
    .map((c, i) =>
      c.width ? `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>` : '',
    )
    .join('')

  const header = sheet.columns
    .map((c, i) =>
      cellXml(`${colName(i)}1`, c.header, c.align === 'center' ? STYLE.headerCenter : STYLE.header),
    )
    .join('')

  const body = sheet.rows
    .map((row, r) => {
      const n = r + 2
      const cells = row
        .map((v, i) => cellXml(`${colName(i)}${n}`, v, sheet.columns[i]?.align === 'center' ? STYLE.center : 0))
        .join('')
      return `<row r="${n}">${cells}</row>`
    })
    .join('')

  // Ordem dos filhos de <worksheet> é fixa no schema: sheetViews, cols,
  // sheetData, autoFilter. Fora dela o Excel abre o "reparar arquivo".
  return (
    XML_HEAD +
    `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    '<sheetViews><sheetView workbookViewId="0">' +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
    '</sheetView></sheetViews>' +
    (cols ? `<cols>${cols}</cols>` : '') +
    `<sheetData><row r="1">${header}</row>${body}</sheetData>` +
    `<autoFilter ref="${range}"/>` +
    '</worksheet>'
  )
}

/** Célula vazia não é escrita: `<c>` sem valor é ruído para todo leitor. */
function cellXml(ref: string, value: XlsxCell, style: number): string {
  const s = style ? ` s="${style}"` : ''
  if (value === null || value === '') return ''
  if (typeof value === 'number') {
    return Number.isFinite(value) ? `<c r="${ref}"${s}><v>${value}</v></c>` : ''
  }
  if (typeof value === 'string') {
    return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${esc(value)}</t></is></c>`
  }
  const serial = excelSerial(value.dateTime)
  return serial === null ? '' : `<c r="${ref}" s="${STYLE.dateTime}"><v>${serial}</v></c>`
}

/**
 * "2026-09-12T14:30" -> dias desde 30/12/1899 (o zero do Excel, que já embute
 * o 29/02/1900 que não existiu). Contado em UTC só para não haver fuso no
 * meio: o valor é o relógio de parede que veio, sem conversão.
 */
export function excelSerial(dateTime: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(dateTime)
  if (!m) return null
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0))
  return ms / 86_400_000 + 25_569
}

/** 0 -> A, 25 -> Z, 26 -> AA. */
export function colName(index: number): string {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** O Excel recusa nome de aba com estes caracteres ou com mais de 31. */
function sheetName(raw: string): string {
  const clean = raw.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31)
  return clean || 'Planilha'
}

// XML 1.0 não aceita a maioria dos caracteres de controle: um nome colado de
// algum lugar com um deles faria o Excel recusar o arquivo inteiro.
const INVALID_XML = /[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g

function esc(s: string): string {
  return s
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// --- ZIP (STORE) ---------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// Data fixa (01/01/1980, o zero do DOS) nas entradas: o mesmo conteúdo gera
// sempre os mesmos bytes, e nenhum leitor de planilha olha esse campo.
const DOS_DATE = (1 << 5) | 1

function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const f of files) {
    const name = enc.encode(f.name)
    const crc = crc32(f.data)
    const size = f.data.length

    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true) // versão necessária
    lv.setUint16(8, 0, true) // método 0 = STORE
    lv.setUint16(12, DOS_DATE, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true)
    lv.setUint32(22, size, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)

    const entry = new Uint8Array(46 + name.length)
    const cv = new DataView(entry.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true) // versão que gravou
    cv.setUint16(6, 20, true) // versão necessária
    cv.setUint16(10, 0, true) // método 0 = STORE
    cv.setUint16(14, DOS_DATE, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    entry.set(name, 46)

    parts.push(local, f.data)
    central.push(entry)
    offset += local.length + size
  }

  const centralSize = central.reduce((sum, e) => sum + e.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  const all = [...parts, ...central, end]
  const out = new Uint8Array(all.reduce((sum, p) => sum + p.length, 0))
  let at = 0
  for (const p of all) {
    out.set(p, at)
    at += p.length
  }
  return out
}
