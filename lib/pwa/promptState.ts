// lib/pwa/promptState.ts
// Decide, de forma pura e testável, qual convite mostrar: instalar o app ou
// permitir notificações. Não toca em browser nenhum — recebe um retrato do
// ambiente e devolve a decisão.

export type PromptInput = {
  isMobile: boolean
  isIOS: boolean
  isInAppBrowser: boolean // Instagram, Facebook, etc.
  standalone: boolean // já instalado / rodando como app
  installable: boolean // beforeinstallprompt capturado
  pushSupported: boolean
  permission: NotificationPermission
  dismissedAt: number | null // epoch ms da última dispensa do sheet
  now: number
}

export type PromptDecision =
  | 'none'
  | 'install-ios' // sheet com o passo a passo animado
  | 'install-ios-inapp' // "abra no Safari primeiro"
  | 'install-android' // sheet com o prompt nativo
  | 'push-ask' // faixa: ativar notificações
  | 'push-blocked' // faixa: como desbloquear

export const DISMISS_WINDOW_MS = 24 * 60 * 60 * 1000

function dispensadoAgora(dismissedAt: number | null, now: number): boolean {
  if (dismissedAt === null) return false
  return now - dismissedAt < DISMISS_WINDOW_MS
}

// O convite de push só faz sentido se o dispositivo suporta e a pessoa ainda
// não decidiu (ou decidiu não).
function decidePush(input: PromptInput): PromptDecision {
  if (!input.pushSupported) return 'none'
  if (input.permission === 'granted') return 'none'
  if (input.permission === 'denied') return 'push-blocked'
  return 'push-ask'
}

export function resolvePrompt(input: PromptInput): PromptDecision {
  // 1. Desktop nunca vê nada: ninguém instala PWA no PC e o dono da academia
  //    trabalha no painel pelo computador.
  if (!input.isMobile) return 'none'

  // 2. Já instalado: só resta a conversa sobre notificações.
  if (input.standalone) return decidePush(input)

  // 3. iOS sem instalar. Push no iOS exige instalação, então nem mencionamos.
  if (input.isIOS) {
    // In-app browser não tem "Adicionar à Tela de Início" no menu — sem isso o
    // passo a passo mentiria. Não é dispensável: é um beco sem saída.
    if (input.isInAppBrowser) return 'install-ios-inapp'
    if (dispensadoAgora(input.dismissedAt, input.now)) return 'none'
    return 'install-ios'
  }

  // 4. Android/Chrome com o evento nativo em mãos.
  if (input.installable) {
    if (dispensadoAgora(input.dismissedAt, input.now)) return 'none'
    return 'install-android'
  }

  // 5. Sobrou: Android que não pode instalar agora (já instalou antes, browser
  //    sem suporte). Segue para a conversa de notificações.
  return decidePush(input)
}
