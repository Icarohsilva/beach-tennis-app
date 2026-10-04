// lib/checkin/receiptReader.ts
// Lê o print do Wellhub com OCR (Tesseract, código aberto, roda no próprio
// servidor — sem custo por leitura e sem chave de API) e devolve os campos que
// as regras de lib/checkin/receiptCheck.ts precisam. Só servidor: é importado
// pela server action (features/checkin/appCheckinActions.ts).
//
// Duas passadas, porque a tela tem texto claro sobre o rosa e texto escuro sobre
// o branco: a imagem INVERTIDA em cinza lê o título ("Check-in confirmado") e o
// logo, e a original é a segunda chance para o cartão com a data. O texto das
// duas vai junto para o parser (lib/checkin/receiptText.ts).
//
// Devolve null quando o OCR falha: quem chama decide — no check-in pelo app o
// registro entra como "conferir" em vez de travar o aluno por um problema nosso.
import path from 'path'
import sharp from 'sharp'
import { createWorker } from 'tesseract.js'
import type { ReceiptReading } from './receiptCheck'
import { hasCardDate, parseReceiptText } from './receiptText'

// Modelo de português que vem no pacote: nada é baixado em tempo de execução
// (e o arquivo entra no deploy por outputFileTracingIncludes, em next.config.js).
const LANG_PATH = path.join(process.cwd(), 'node_modules/@tesseract.js-data/por/4.0.0_best_int')

export async function readWellhubReceipt(image: Uint8Array): Promise<ReceiptReading | null> {
  let worker: Awaited<ReturnType<typeof createWorker>> | null = null
  try {
    worker = await createWorker('por', 1, { langPath: LANG_PATH, cacheMethod: 'none', gzip: true })

    const inverted = await sharp(Buffer.from(image)).grayscale().negate().toBuffer()
    const first = (await worker.recognize(inverted)).data.text
    let text = first
    if (!hasCardDate(first)) {
      text += '\n' + (await worker.recognize(Buffer.from(image))).data.text
    }
    return parseReceiptText(text)
  } catch (err) {
    console.error('[receiptReader] OCR falhou', err)
    return null
  } finally {
    await worker?.terminate().catch(() => {})
  }
}
