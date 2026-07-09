import { readFileSync } from 'fs'
import { join } from 'path'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MarkdownDoc } from './MarkdownDoc'

const MANUALS = {
  academia: { file: 'academia.md', title: 'Manual da Academia', other: 'aluno', otherLabel: 'Manual do Aluno' },
  aluno: { file: 'aluno.md', title: 'Manual do Aluno', other: 'academia', otherLabel: 'Manual da Academia' },
} as const

type ManualKey = keyof typeof MANUALS

export const dynamicParams = false

export function generateStaticParams() {
  return (Object.keys(MANUALS) as ManualKey[]).map((manual) => ({ manual }))
}

export function generateMetadata({ params }: { params: { manual: string } }): Metadata {
  const manual = MANUALS[params.manual as ManualKey]
  return { title: manual ? `${manual.title} — ArenaHub` : 'Documentação — ArenaHub' }
}

function loadContent(file: string): string {
  const raw = readFileSync(join(process.cwd(), 'docs', 'faq', file), 'utf8')
  return raw
    // imagens: docs/faq/images -> public/faq/images (servidas em /faq/images)
    .replace(/\]\(images\//g, '](/faq/images/')
    // links entre manuais: aluno.md / academia.md -> rotas in-app
    .replace(/\]\(aluno\.md\)/g, '](/ajuda/aluno)')
    .replace(/\]\(academia\.md\)/g, '](/ajuda/academia)')
}

export default function AjudaManualPage({ params }: { params: { manual: string } }) {
  const manual = MANUALS[params.manual as ManualKey]
  if (!manual) notFound()

  const content = loadContent(manual.file)

  return (
    <div className="min-h-screen bg-surface text-slate-200">
      <header className="sticky top-0 z-10 border-b border-surface-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <span className="text-sm font-bold text-white">
            <span className="text-brand-500">Arena</span>Hub · Documentação
          </span>
          <Link
            href={`/ajuda/${manual.other}`}
            className="rounded-lg border border-surface-border px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-surface-border hover:text-white transition-colors"
          >
            {manual.otherLabel} →
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <MarkdownDoc content={content} />
      </main>
    </div>
  )
}
