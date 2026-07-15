// lib/pwa/onboardingState.ts
// Decide, de forma pura e testável, o que o card de onboarding deve mostrar.
export type OnboardingInput = {
  permission: NotificationPermission // 'default' | 'granted' | 'denied'
  standalone: boolean                // app instalado / rodando em modo standalone
  isIOS: boolean
  installable: boolean               // beforeinstallprompt capturado (Android/desktop)
  pushSupported: boolean
}

export type OnboardingStep =
  | 'hidden'
  | 'ios-install-first'
  | 'install'
  | 'enable-push'
  | 'push-blocked'

export function resolveOnboardingStep(input: OnboardingInput): OnboardingStep {
  const { permission, standalone, isIOS, installable, pushSupported } = input

  // Nada a oferecer: sem push, sem instalação e não é iOS-por-instalar.
  if (!pushSupported && !installable && !(isIOS && !standalone)) return 'hidden'

  // Já concedeu e não há instalação pendente relevante → nada a fazer.
  if (permission === 'granted' && (standalone || (!isIOS && !installable))) return 'hidden'

  // Bloqueado no nível do navegador → orientar a reabrir nas configurações.
  if (permission === 'denied') return 'push-blocked'

  // iOS só recebe push depois de instalado na tela inicial.
  if (isIOS && !standalone) return 'ios-install-first'

  // Android/desktop instalável → oferecer o prompt nativo.
  if (installable && !standalone) return 'install'

  // Pode pedir a permissão agora.
  return 'enable-push'
}
