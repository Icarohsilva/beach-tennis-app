'use client'
// features/torneios/ExportMatchesButton.tsx
// A planilha é montada no servidor (matchesToSheet) e só vira arquivo aqui,
// no clique — mesmo caminho do "Baixar planilha" das camisas.
import { FileSpreadsheet } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { buildXlsx, XLSX_MIME, type XlsxSheet } from '@/lib/utils/xlsx'

export function ExportMatchesButton({ sheet, fileName }: { sheet: XlsxSheet; fileName: string }) {
  function download() {
    const url = URL.createObjectURL(new Blob([buildXlsx(sheet)], { type: XLSX_MIME }))
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    // Revogar no mesmo tick do clique aborta o download em navegador que só lê
    // o blob depois (Safari no iPhone); o FileSaver.js espera 40s pelo mesmo motivo.
    setTimeout(() => URL.revokeObjectURL(url), 40_000)
  }

  return (
    <Button size="sm" variant="secondary" onClick={download} className="shrink-0 gap-1.5">
      <FileSpreadsheet className="h-4 w-4" aria-hidden />
      Exportar Excel
    </Button>
  )
}
