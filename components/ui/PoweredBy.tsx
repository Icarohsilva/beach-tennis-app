import Image from 'next/image'

const SYMBOL = '/brand/arenahub-symbol-transparent.png'

/** Selo co-branding. Sempre visível nos rodapés (app aluno, admin, página pública). */
export function PoweredBy({ className = '' }: { className?: string }) {
  return (
    <a
      href="https://arenahub.website"
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-400 transition-colors ${className}`}
    >
      <span>Powered by</span>
      <Image src={SYMBOL} alt="" aria-hidden width={14} height={14} className="object-contain opacity-70" />
      <span className="font-semibold text-slate-400">ArenaHub</span>
    </a>
  )
}
