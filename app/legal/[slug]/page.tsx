// app/legal/[slug]/page.tsx
import { readFileSync } from 'fs'
import { join } from 'path'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MarkdownDoc } from '@/components/docs/MarkdownDoc'
import { LEGAL_DOCUMENTS, type LegalSlug } from '@/lib/legal/documents'

export const dynamicParams = false

export function generateStaticParams() {
  return (Object.keys(LEGAL_DOCUMENTS) as LegalSlug[]).map((slug) => ({ slug }))
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const doc = LEGAL_DOCUMENTS[params.slug as LegalSlug]
  return { title: doc ? `${doc.title} | ArenaHub` : 'Documento legal | ArenaHub' }
}

function loadContent(file: string): string {
  return readFileSync(join(process.cwd(), 'docs', 'legal', file), 'utf8')
}

function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export default function LegalDocPage({ params }: { params: { slug: string } }) {
  const doc = LEGAL_DOCUMENTS[params.slug as LegalSlug]
  if (!doc) notFound()

  const content = loadContent(doc.file)

  return (
    <div className="min-h-screen bg-surface text-slate-200">
      <header className="sticky top-0 z-10 border-b border-surface-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <span className="text-sm font-bold text-white">
            <span className="text-brand-500">Arena</span>Hub · {doc.title}
          </span>
          <Link
            href="/"
            className="rounded-lg border border-surface-border px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-surface-border hover:text-white transition-colors"
          >
            Início →
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <p className="mb-4 text-xs text-slate-500">
          Versão {doc.version}, vigente desde {formatDateBR(doc.effectiveDate)}
        </p>
        <MarkdownDoc content={content} />
      </main>
    </div>
  )
}
