'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSlug from 'rehype-slug'
import type { Components } from 'react-markdown'

const components: Components = {
  h1: ({ children, ...p }) => (
    <h1 {...p} className="scroll-mt-20 mt-8 mb-4 text-2xl font-extrabold text-white first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children, ...p }) => (
    <h2 {...p} className="scroll-mt-20 mt-8 mb-3 border-b border-surface-border pb-2 text-xl font-bold text-white">
      {children}
    </h2>
  ),
  h3: ({ children, ...p }) => (
    <h3 {...p} className="scroll-mt-20 mt-6 mb-2 text-lg font-semibold text-white">
      {children}
    </h3>
  ),
  p: ({ children, ...p }) => (
    <p {...p} className="my-3 leading-relaxed text-slate-300">
      {children}
    </p>
  ),
  a: ({ children, href, ...p }) => {
    const external = href?.startsWith('http')
    return (
      <a
        {...p}
        href={href}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        className="font-medium text-brand-400 underline underline-offset-2 hover:text-brand-300"
      >
        {children}
      </a>
    )
  },
  ul: ({ children, ...p }) => (
    <ul {...p} className="my-3 list-disc space-y-1 pl-6 text-slate-300 marker:text-brand-500">
      {children}
    </ul>
  ),
  ol: ({ children, ...p }) => (
    <ol {...p} className="my-3 list-decimal space-y-1 pl-6 text-slate-300 marker:text-slate-500">
      {children}
    </ol>
  ),
  li: ({ children, ...p }) => (
    <li {...p} className="leading-relaxed">
      {children}
    </li>
  ),
  strong: ({ children, ...p }) => (
    <strong {...p} className="font-semibold text-white">
      {children}
    </strong>
  ),
  blockquote: ({ children, ...p }) => (
    <blockquote
      {...p}
      className="my-4 rounded-r-lg border-l-4 border-brand-600 bg-surface-card/60 px-4 py-2 text-slate-300 [&_p]:my-1.5"
    >
      {children}
    </blockquote>
  ),
  img: ({ src, alt }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={typeof src === 'string' ? src : ''}
      alt={alt ?? ''}
      loading="lazy"
      className="my-4 w-full max-w-2xl rounded-lg border border-surface-border shadow-lg"
    />
  ),
  hr: (p) => <hr {...p} className="my-8 border-surface-border" />,
  code: ({ children, className, ...p }) => {
    const isBlock = className?.includes('language-')
    if (isBlock) {
      return (
        <code {...p} className="text-sm text-slate-200">
          {children}
        </code>
      )
    }
    return (
      <code {...p} className="rounded bg-surface-border/60 px-1.5 py-0.5 font-mono text-[0.85em] text-brand-300">
        {children}
      </code>
    )
  },
  pre: ({ children, ...p }) => (
    <pre
      {...p}
      className="my-4 overflow-x-auto rounded-lg border border-surface-border bg-surface-card p-4 font-mono text-sm"
    >
      {children}
    </pre>
  ),
  table: ({ children, ...p }) => (
    <div className="my-4 overflow-x-auto rounded-lg border border-surface-border">
      <table {...p} className="w-full border-collapse text-sm">
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...p }) => (
    <thead {...p} className="bg-surface-card">
      {children}
    </thead>
  ),
  th: ({ children, ...p }) => (
    <th {...p} className="border-b border-surface-border px-3 py-2 text-left font-semibold text-white">
      {children}
    </th>
  ),
  td: ({ children, ...p }) => (
    <td {...p} className="border-b border-surface-border px-3 py-2 align-top text-slate-300">
      {children}
    </td>
  ),
}

export function MarkdownDoc({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug]} components={components}>
      {content}
    </ReactMarkdown>
  )
}
