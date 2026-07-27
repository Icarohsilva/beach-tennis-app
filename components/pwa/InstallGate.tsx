'use client'
// components/pwa/InstallGate.tsx
// Junta ambiente + permissão + dispensa, chama resolvePrompt e renderiza o que
// ele decidir. Montado nos layouts de aluno e admin; se auto-suprime no desktop.
import { useCallback, useEffect, useState } from 'react'
import { readEnvironment } from '@/lib/pwa/environment'
import { resolvePrompt, type PromptDecision } from '@/lib/pwa/promptState'
import { readDismissedAt, writeDismissedAt } from '@/lib/pwa/dismissStorage'
import { InstallSheet } from './InstallSheet'
import { PushNagBanner } from './PushNagBanner'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

declare global {
  interface Window {
    __arenahubInstallEvent?: BeforeInstallPromptEvent
  }
}

export function InstallGate() {
  const [decision, setDecision] = useState<PromptDecision>('none')

  const recompute = useCallback(() => {
    if (typeof window === 'undefined') return
    const env = readEnvironment()
    setDecision(
      resolvePrompt({
        ...env,
        installable: Boolean(window.__arenahubInstallEvent),
        permission: 'Notification' in window ? Notification.permission : 'denied',
        dismissedAt: readDismissedAt(),
        now: Date.now(),
      }),
    )
  }, [])

  useEffect(() => {
    // Roda depois da hidratação: o evento pode já ter sido capturado pelo
    // script inline do layout raiz antes de o React existir.
    recompute()

    const onInstalled = () => {
      window.__arenahubInstallEvent = undefined
      recompute()
    }
    // Emitido pelo script inline quando o evento chega depois da hidratação.
    window.addEventListener('arenahub:installable', recompute)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('arenahub:installable', recompute)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [recompute])

  function dispensar() {
    writeDismissedAt()
    recompute()
  }

  async function instalar() {
    const evt = window.__arenahubInstallEvent
    if (!evt) return
    try {
      await evt.prompt()
      await evt.userChoice
    } finally {
      // O evento só pode ser usado uma vez, aceito ou recusado. Mesmo se
      // prompt() lançar, ele já não serve mais — descartar evita reoferecer
      // um botão que não faz nada.
      window.__arenahubInstallEvent = undefined
      recompute()
    }
  }

  if (decision === 'none') return null
  if (decision === 'push-ask' || decision === 'push-blocked') {
    return <PushNagBanner state={decision} onOutcome={recompute} />
  }
  return <InstallSheet decision={decision} onDismiss={dispensar} onInstall={instalar} />
}
