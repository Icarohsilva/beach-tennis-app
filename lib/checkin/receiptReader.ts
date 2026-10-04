// lib/checkin/receiptReader.ts
// Lê o print do Wellhub com OCR (Tesseract, código aberto, roda no próprio
// servidor — sem custo por leitura e sem chave de API) e devolve os campos que
// as regras de lib/checkin/receiptCheck.ts precisam. Só servidor: é importado
// pela server action (features/checkin/appCheckinActions.ts).
//
// TEMPO é requisito: o aluno está na frente do celular esperando, e a análise
// toda tem de caber em 10 s. Por isso:
//  - teto de READ_BUDGET_MS: estourou, devolve null e o check-in entra como
//    "conferir" — nunca deixa o aluno olhando uma rodinha;
//  - o leitor (worker) é reaproveitado entre envios enquanto a função está
//    quente: subir o Tesseract e o modelo custa ~1,2 s, ler custa ~0,5 s;
//  - a imagem é reduzida a OCR_WIDTH antes de ler (o texto do cartão segue
//    legível e a leitura cai ~30%);
//  - uma passada na imagem INVERTIDA em cinza lê o título claro sobre o rosa e o
//    cartão; a original só é lida se o cartão não saiu E ainda há tempo.
//
// O motor do Tesseract é um .wasm lido do disco: se ele não estiver no deploy,
// o worker não sobe e NÃO dá erro — fica esperando. É o que aconteceu na
// Vercel antes de `outputFileTracingIncludes` (next.config.js) levar os .wasm
// junto; o teto acima é a rede de segurança para qualquer coisa parecida.
import path from 'path'
import sharp from 'sharp'
import { createWorker } from 'tesseract.js'
import type { ReceiptReading } from './receiptCheck'
import { hasCardDate, parseReceiptText } from './receiptText'

// Modelo de português que vem no pacote: nada é baixado em tempo de execução.
const LANG_PATH = path.join(process.cwd(), 'node_modules/@tesseract.js-data/por/4.0.0_best_int')

/** Teto da leitura inteira. O resto da action (banco + upload) cabe no que sobra dos 10 s. */
export const READ_BUDGET_MS = 6_000
/** Largura usada no OCR: menor que isso, o "12h59 • 4 out" do cartão começa a falhar. */
const OCR_WIDTH = 600

type Worker = Awaited<ReturnType<typeof createWorker>>
let workerPromise: Promise<Worker> | null = null

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('por', 1, { langPath: LANG_PATH, cacheMethod: 'none', gzip: true })
    // Falhou ao subir: esquece, para o próximo envio tentar de novo do zero.
    workerPromise.catch(() => { workerPromise = null })
  }
  return workerPromise
}

/** Descarta o leitor (travado ou com erro): o próximo envio sobe outro. */
function dropWorker() {
  const p = workerPromise
  workerPromise = null
  p?.then((w) => w.terminate()).catch(() => {})
}

class Timeout extends Error {}

function withBudget<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    p,
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Timeout()), ms) }),
  ]).finally(() => clearTimeout(timer))
}

async function read(image: Uint8Array, startedAt: number): Promise<ReceiptReading> {
  const worker = await getWorker()
  const small = sharp(Buffer.from(image)).resize({ width: OCR_WIDTH, withoutEnlargement: true })
  const inverted = await small.clone().grayscale().negate().toBuffer()
  let text = (await worker.recognize(inverted)).data.text

  // Segunda chance na imagem original só se o cartão não saiu e o tempo deixa:
  // uma leitura leva ~0,5 s aqui, mas a CPU da função pode ser bem mais lenta.
  if (!hasCardDate(text) && Date.now() - startedAt < READ_BUDGET_MS / 2) {
    text += '\n' + (await worker.recognize(await small.clone().toBuffer())).data.text
  }
  return parseReceiptText(text)
}

/**
 * Devolve null quando a leitura não termina no teto ou falha: quem chama
 * decide — no check-in pelo app o registro entra como "conferir" em vez de
 * travar o aluno por um problema nosso.
 */
export async function readWellhubReceipt(image: Uint8Array): Promise<ReceiptReading | null> {
  const startedAt = Date.now()
  try {
    return await withBudget(read(image, startedAt), READ_BUDGET_MS)
  } catch (err) {
    // Leitor que estourou o tempo pode estar travado no meio de uma leitura:
    // reaproveitá-lo prenderia o próximo envio na fila dele.
    dropWorker()
    if (err instanceof Timeout) {
      console.error('[receiptReader] OCR passou do teto', { ms: Date.now() - startedAt })
    } else {
      console.error('[receiptReader] OCR falhou', err)
    }
    return null
  }
}
