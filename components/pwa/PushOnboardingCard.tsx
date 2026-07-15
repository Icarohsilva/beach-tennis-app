'use client'
// components/pwa/PushOnboardingCard.tsx
// Card de onboarding na home: instalar o app e/ou ativar notificações, na ordem
// certa por plataforma. A decisão do que mostrar vem de resolveOnboardingStep.
import { useEffect, useState } from 'react'
import { Bell, Download, Share, X } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { resolveOnboardingStep, type OnboardingStep } from '@/lib/pwa/onboardingState'
import { isPushSupported, subscribeToPush } from '@/lib/pwa/pushClient'

const DISMISS_KEY = 'pwa-onboarding-dismissed'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function detectIsIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const mql = window.matchMedia('(display-mode: standalone)').matches
  const iosStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true
  return mql || iosStandalone
}

export function PushOnboardingCard() {
  const [step, setStep] = useState<OnboardingStep>('hidden')
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  // Recalcula o passo a partir do estado atual do ambiente.
  function recompute(installable: boolean) {
    if (typeof window === 'undefined') return
    if (localStorage.getItem(DISMISS_KEY) === '1') {
      setStep('hidden')
      return
    }
    const permission = 'Notification' in window ? Notification.permission : 'denied'
    setStep(
      resolveOnboardingStep({
        permission,
        standalone: detectStandalone(),
        isIOS: detectIsIOS(),
        installable,
        pushSupported: isPushSupported(),
      }),
    )
  }

  useEffect(() => {
    recompute(false)
    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      recompute(true)
    }
    const onInstalled = () => {
      setDeferredPrompt(null)
      recompute(false)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleInstall() {
    if (!deferredPrompt) return
    setBusy(true)
    await deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setDeferredPrompt(null)
    setBusy(false)
    recompute(false)
  }

  async function handleEnablePush() {
    setBusy(true)
    setMsg(null)
    const res = await subscribeToPush()
    setBusy(false)
    if (res.error) {
      setMsg(res.error)
    } else {
      recompute(false)
    }
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1')
    setStep('hidden')
  }

  if (step === 'hidden') return null

  return (
    <Card className="relative border-brand-600/40 bg-brand-600/5">
      <button
        onClick={dismiss}
        aria-label="Dispensar"
        className="absolute right-3 top-3 text-slate-500 hover:text-white transition-colors"
      >
        <X size={16} />
      </button>

      {step === 'ios-install-first' && (
        <div className="pr-6">
          <div className="flex items-center gap-2 mb-1">
            <Share size={18} className="text-brand-500" />
            <p className="text-sm font-semibold text-white">Instale o app para receber avisos</p>
          </div>
          <p className="text-xs text-slate-400">
            Toque em <strong>Compartilhar</strong> e depois em{' '}
            <strong>&ldquo;Adicionar à Tela de Início&rdquo;</strong>. Abra o app pela tela inicial
            e ative as notificações por aqui.
          </p>
        </div>
      )}

      {step === 'install' && (
        <div className="pr-6">
          <div className="flex items-center gap-2 mb-2">
            <Download size={18} className="text-brand-500" />
            <p className="text-sm font-semibold text-white">Instale o app no seu celular</p>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            Adicione o ArenaHub à tela inicial para abrir com um toque e receber notificações.
          </p>
          <Button onClick={handleInstall} loading={busy} size="sm">
            Instalar app
          </Button>
        </div>
      )}

      {step === 'enable-push' && (
        <div className="pr-6">
          <div className="flex items-center gap-2 mb-2">
            <Bell size={18} className="text-brand-500" />
            <p className="text-sm font-semibold text-white">Ative as notificações</p>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            Receba avisos de aula cancelada, vaga na fila, crédito baixo e mensagens da academia.
          </p>
          <Button onClick={handleEnablePush} loading={busy} size="sm">
            Ativar notificações
          </Button>
          {msg && <p className="text-xs text-red-400 mt-2">{msg}</p>}
        </div>
      )}

      {step === 'push-blocked' && (
        <div className="pr-6">
          <div className="flex items-center gap-2 mb-1">
            <Bell size={18} className="text-slate-400" />
            <p className="text-sm font-semibold text-white">Notificações bloqueadas</p>
          </div>
          <p className="text-xs text-slate-400">
            Você bloqueou as notificações no navegador. Reabilite nas configurações do site
            (cadeado ao lado do endereço) para voltar a receber avisos.
          </p>
        </div>
      )}
    </Card>
  )
}
