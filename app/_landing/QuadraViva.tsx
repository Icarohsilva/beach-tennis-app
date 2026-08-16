'use client'

import { useEffect, useRef } from 'react'

/**
 * Quadra em perspectiva desenhada em canvas, atrás do hero.
 *
 * É a mesma geometria que está impressa no convite entregue nas arenas: lá ela
 * é uma linha parada, aqui ela está viva. Quem escaneia o QR do papel e cai no
 * site reconhece a peça, e essa continuidade é o ponto.
 *
 * Canvas 2D em vez de WebGL/Three.js de propósito. O desenho é linha reta e
 * gradiente, coisa que o 2D faz nativo, e o público é dono de arena abrindo o
 * link no celular, muitas vezes no 4G da quadra. Three.js custa 23 MB
 * desempacotados para entregar exatamente a mesma imagem.
 */

type Ponto = { x: number; y: number }

// Horizonte e bordas em fração da área, para o desenho acompanhar qualquer tela.
const HORIZONTE = 0.3
const FAR = [0.36, 0.64]
const NEAR = [-0.14, 1.14]
const REDE = 0.42 // profundidade da rede, 0 = fundo, 1 = frente
const ALTURA_REDE = 0.1

export function QuadraViva({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const paradinho = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let w = 0
    let h = 0
    let raf = 0
    let inicio = 0
    let visivel = true

    const medir = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const r = canvas.getBoundingClientRect()
      w = r.width
      h = r.height
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    // Profundidade não é linear: perto do horizonte as linhas se acumulam.
    const proj = (d: number): { y: number; e: number; dir: number } => {
      const t = Math.pow(d, 1.9)
      const yFar = h * HORIZONTE
      const yNear = h * 1.04
      return {
        y: yFar + (yNear - yFar) * t,
        e: w * (FAR[0] + (NEAR[0] - FAR[0]) * t),
        dir: w * (FAR[1] + (NEAR[1] - FAR[1]) * t),
      }
    }

    const linha = (a: Ponto, b: Ponto, alpha: number, largura = 1) => {
      if (alpha <= 0.002) return
      ctx.globalAlpha = alpha
      ctx.lineWidth = largura
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }

    const desenhar = (tempo: number) => {
      const t = paradinho ? 0 : (tempo - inicio) / 1000
      ctx.clearRect(0, 0, w, h)
      ctx.strokeStyle = '#f97316'
      ctx.lineCap = 'round'

      // O brilho varre a quadra do fundo para a frente, como uma passada de luz.
      const varredura = paradinho ? 0.55 : (t * 0.16) % 1.35

      // Linhas de profundidade (as "raias")
      const nRaias = 9
      for (let i = 0; i <= nRaias; i++) {
        const f = i / nRaias
        const a = proj(0)
        const b = proj(1)
        linha(
          { x: a.e + (a.dir - a.e) * f, y: a.y },
          { x: b.e + (b.dir - b.e) * f, y: b.y },
          0.03 + (i === 0 || i === nRaias ? 0.055 : 0)
        )
      }

      // Linhas transversais, com o realce da varredura
      const nTrans = 16
      for (let i = 0; i <= nTrans; i++) {
        const d = i / nTrans
        const p = proj(d)
        const perto = 1 - Math.min(1, Math.abs(d - varredura) / 0.16)
        linha({ x: p.e, y: p.y }, { x: p.dir, y: p.y }, 0.028 + perto * 0.16, 1 + perto * 0.6)
      }

      // Rede
      const r = proj(REDE)
      const topo = r.y - h * ALTURA_REDE
      linha({ x: r.e, y: r.y }, { x: r.dir, y: r.y }, 0.17, 1.2)
      linha({ x: r.e, y: topo }, { x: r.dir, y: topo }, 0.17, 1.2)
      linha({ x: r.e, y: r.y }, { x: r.e, y: topo }, 0.17, 1.2)
      linha({ x: r.dir, y: r.y }, { x: r.dir, y: topo }, 0.17, 1.2)
      for (let i = 1; i < 24; i++) {
        const x = r.e + ((r.dir - r.e) / 24) * i
        linha({ x, y: topo }, { x, y: r.y }, 0.05)
      }

      // Horários preenchendo: cada célula acende e fica acesa, que é a leitura
      // que o produto quer passar (a agenda enchendo sozinha).
      const cols = 7
      const rows = 3
      const ciclo = 9
      for (let c = 0; c < cols; c++) {
        for (let l = 0; l < rows; l++) {
          const ordem = (c * rows + l) / (cols * rows)
          const fase = paradinho ? 1 : ((t / ciclo) % 1.4) - ordem
          if (fase <= 0) continue
          const brilho = Math.min(1, fase * 6) * (0.1 + 0.5 * Math.min(1, fase * 2))
          const d0 = 0.4 + (l / rows) * 0.3
          const d1 = 0.4 + ((l + 1) / rows) * 0.3 - 0.01
          const a = proj(d0)
          const b = proj(d1)
          const f0 = c / cols + 0.012
          const f1 = (c + 1) / cols - 0.012
          ctx.globalAlpha = brilho * 0.1
          ctx.fillStyle = '#f97316'
          ctx.beginPath()
          ctx.moveTo(a.e + (a.dir - a.e) * f0, a.y)
          ctx.lineTo(a.e + (a.dir - a.e) * f1, a.y)
          ctx.lineTo(b.e + (b.dir - b.e) * f1, b.y)
          ctx.lineTo(b.e + (b.dir - b.e) * f0, b.y)
          ctx.closePath()
          ctx.fill()
        }
      }

      ctx.globalAlpha = 1
      if (!paradinho && visivel) raf = requestAnimationFrame(desenhar)
    }

    const iniciar = (tempo: number) => {
      inicio = tempo
      desenhar(tempo)
    }

    medir()
    raf = requestAnimationFrame(iniciar)

    const aoRedimensionar = () => {
      medir()
      if (paradinho) desenhar(performance.now())
    }
    // Aba escondida não precisa de rAF, e o navegador já o congela, mas parar
    // explicitamente evita um quadro atrasado ao voltar.
    const aoTrocarAba = () => {
      visivel = document.visibilityState === 'visible'
      if (visivel && !paradinho) {
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(desenhar)
      }
    }

    window.addEventListener('resize', aoRedimensionar)
    document.addEventListener('visibilitychange', aoTrocarAba)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', aoRedimensionar)
      document.removeEventListener('visibilitychange', aoTrocarAba)
    }
  }, [])

  return <canvas ref={ref} aria-hidden="true" className={className} />
}
