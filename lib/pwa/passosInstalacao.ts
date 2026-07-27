// lib/pwa/passosInstalacao.ts
// Textos do passo a passo de instalação no iPhone.
//
// Moram aqui, e não dentro de IosInstallAnimation.tsx, porque aquele módulo é
// 'use client': um Server Component que importe uma constante de lá recebe um
// proxy de referência de client, não o array — e chamar .map() nele lança
// "Attempted to call map() from the server but map is on the client".
// A página /instalar é Server Component e precisa iterar PASSOS_TEXTO.

export const SCENE_LEGENDAS = [
  'Toque no botão Compartilhar, na barra de baixo',
  'O menu vai subir na tela',
  'Role a lista até achar a opção',
  'Toque em "Adicionar à Tela de Início"',
  'Confirme em "Adicionar", lá em cima',
  'Pronto! O ArenaHub está na sua tela 🎉',
] as const

export const SCENE_COUNT = SCENE_LEGENDAS.length
export const SCENE_MS = 2200

// Passos em texto, para quem não quer esperar o loop, para prefers-reduced-motion
// e para leitores de tela.
export const PASSOS_TEXTO = [
  'Abra o ArenaHub no Safari (não funciona pelo Instagram nem pelo Chrome).',
  'Toque no botão Compartilhar — o quadradinho com a seta pra cima, na barra de baixo.',
  'Role o menu e toque em "Adicionar à Tela de Início".',
  'Toque em "Adicionar" no canto superior direito. O ícone aparece na sua tela.',
] as const
