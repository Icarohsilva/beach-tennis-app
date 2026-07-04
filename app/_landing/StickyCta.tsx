'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import s from './sticky-cta.module.css'

export function StickyCta() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const hero = document.querySelector('header')
    const finalCta = document.querySelector('[data-final-cta]')
    if (!hero) return
    let heroOut = false
    let finalIn = false
    const update = () => setVisible(heroOut && !finalIn)

    const heroObs = new IntersectionObserver(
      ([e]) => { heroOut = !e.isIntersecting; update() },
      { threshold: 0 },
    )
    heroObs.observe(hero)

    let finalObs: IntersectionObserver | undefined
    if (finalCta) {
      finalObs = new IntersectionObserver(
        ([e]) => { finalIn = e.isIntersecting; update() },
        { threshold: 0 },
      )
      finalObs.observe(finalCta)
    }
    return () => { heroObs.disconnect(); finalObs?.disconnect() }
  }, [])

  return (
    <div className={`${s.bar} ${visible ? s.show : ''}`} aria-hidden={!visible}>
      <Link className={s.cta} href="/criar-academia" tabIndex={visible ? 0 : -1}>
        Criar conta grátis →
      </Link>
    </div>
  )
}
