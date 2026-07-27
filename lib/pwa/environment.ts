// lib/pwa/environment.ts
// Retrato do ambiente do browser para alimentar resolvePrompt. As funções que
// recebem user agent são exportadas separadamente porque são testáveis; o resto
// só existe no client.
import { isPushSupported } from './pushClient'

export function matchesIOS(ua: string): boolean {
  return /iPhone|iPad|iPod/i.test(ua)
}

export function matchesAndroid(ua: string): boolean {
  return /Android/i.test(ua)
}

// Detecção por user agent é frágil por natureza, então erra para o lado seguro:
// na dúvida devolve false e a pessoa vê o passo a passo normal do Safari.
export function matchesInAppBrowser(ua: string): boolean {
  return /FBAN|FBAV|FBIOS|Instagram|Line\/|Twitter|LinkedInApp|MicroMessenger|TikTok/i.test(ua)
}

export type PwaEnvironment = {
  isMobile: boolean
  isIOS: boolean
  isInAppBrowser: boolean
  standalone: boolean
  pushSupported: boolean
}

export function readEnvironment(): PwaEnvironment {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      isMobile: false,
      isIOS: false,
      isInAppBrowser: false,
      standalone: false,
      pushSupported: false,
    }
  }

  const ua = navigator.userAgent
  // iPadOS 13+ se declara como Mac; o toque é o que o denuncia.
  const iPadMascarado =
    navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  const isIOS = matchesIOS(ua) || iPadMascarado
  const isAndroid = matchesAndroid(ua)

  // "Celular" = sistema móvel E tela estreita. Exclui desktop por completo e
  // tablets grandes em paisagem, onde o popup só atrapalharia.
  const isMobile =
    (isIOS || isAndroid) && window.matchMedia('(max-width: 900px)').matches

  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true

  return {
    isMobile,
    isIOS,
    isInAppBrowser: matchesInAppBrowser(ua),
    standalone,
    pushSupported: isPushSupported(),
  }
}
