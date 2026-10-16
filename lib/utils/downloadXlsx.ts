// lib/utils/downloadXlsx.ts
// Só no navegador: transforma a planilha em arquivo e dispara o download.
import { buildXlsx, XLSX_MIME, type XlsxSheet } from './xlsx'

export function downloadXlsx(sheet: XlsxSheet, fileName: string): void {
  const url = URL.createObjectURL(new Blob([buildXlsx(sheet)], { type: XLSX_MIME }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  // Revogar no mesmo tick do clique aborta o download em navegador que só lê
  // o blob depois (Safari no iPhone); o FileSaver.js espera 40s pelo mesmo motivo.
  setTimeout(() => URL.revokeObjectURL(url), 40_000)
}
