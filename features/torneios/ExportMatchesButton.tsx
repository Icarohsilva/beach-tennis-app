'use client'
// features/torneios/ExportMatchesButton.tsx
// A planilha é montada no servidor (matchesToSheet) e só vira arquivo aqui,
// no clique.
import { FileSpreadsheet } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { downloadXlsx } from '@/lib/utils/downloadXlsx'
import type { XlsxSheet } from '@/lib/utils/xlsx'

export function ExportMatchesButton({ sheet, fileName }: { sheet: XlsxSheet; fileName: string }) {
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => downloadXlsx(sheet, fileName)}
      className="shrink-0 gap-1.5"
    >
      <FileSpreadsheet className="h-4 w-4" aria-hidden />
      Exportar Excel
    </Button>
  )
}
