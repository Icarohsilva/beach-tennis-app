// components/ui/AuroraBackground.tsx

/**
 * Manchas de cor desfocadas fixas atrás de todo o conteúdo. Usa a cor da marca
 * da academia (via --brand-*), então cada arena ganha seu próprio ambiente.
 * Decorativo: fora do fluxo, sem eventos de ponteiro e invisível para leitores.
 */
export function AuroraBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="aurora-blob absolute -left-24 -top-32 h-80 w-80 rounded-full bg-[rgb(var(--brand-500)/0.16)] blur-3xl" />
      <div
        className="aurora-blob absolute -right-28 top-24 h-96 w-96 rounded-full bg-[rgb(var(--brand-700)/0.14)] blur-3xl"
        style={{ animationDelay: '-7s' }}
      />
      <div
        className="aurora-blob absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-sky-500/[0.07] blur-3xl"
        style={{ animationDelay: '-14s' }}
      />
    </div>
  )
}
