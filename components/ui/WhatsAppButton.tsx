// components/ui/WhatsAppButton.tsx
// Link de WhatsApp com forma de botão.
//
// Existe porque link externo não pode ser `<button>` (precisa de `<a href>`
// para abrir o app do celular), e cada tela vinha estilizando o `<a>` na mão —
// foi assim que apareceram os "botões" de WhatsApp em texto puro, sem borda nem
// sombra. A forma vem de `buttonClasses`, a mesma do `Button`.
import { MessageCircle } from 'lucide-react'
import { buttonClasses, type ButtonSize } from './Button'

export function WhatsAppButton({
  href,
  children = 'WhatsApp',
  size = 'sm',
  className,
}: {
  href: string
  children?: React.ReactNode
  size?: ButtonSize
  className?: string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={buttonClasses({ variant: 'whatsapp', size, className: `gap-1.5 ${className ?? ''}` })}
    >
      <MessageCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {children}
    </a>
  )
}
