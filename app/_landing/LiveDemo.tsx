'use client'
import { useEffect, useRef, useState } from 'react'
import s from './live-demo.module.css'

const STEPS = [
  { k: 'Dono cria a turma', d: 'Grade recorrente por nível e horário' },
  { k: 'Aluno agenda', d: 'Pelo celular, em segundos' },
  { k: 'Check-in automático', d: 'Wellhub e TotalPass, sem fila' },
  { k: 'Dinheiro no painel', d: 'Você sabe quanto entra' },
]

export function LiveDemo() {
  const [active, setActive] = useState(0)
  const [playing, setPlaying] = useState(false)
  const reduced = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const el = rootRef.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setPlaying(e.isIntersecting), {
      threshold: 0.4,
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!playing || reduced.current) return
    const t = setInterval(() => setActive((a) => (a + 1) % STEPS.length), 2800)
    return () => clearInterval(t)
  }, [playing])

  return (
    <div className={s.demo} ref={rootRef}>
      <div className={s.window}>
        <div className={s.bar}>
          <span className={s.tdot} /><span className={s.tdot} /><span className={s.tdot} />
          <span className={s.url}>app.arenahub.website</span>
        </div>
        <div className={s.stage}>
          <div className={`${s.screen} ${active === 0 ? s.on : ''}`}>
            <div className={s.scLabel}>Painel da arena · Grade</div>
            <div className={s.days}>
              {['Seg', 'Ter', 'Qua', 'Qui', 'Sex'].map((d, i) => (
                <span key={d} className={`${s.day} ${i === 1 ? s.dayOn : ''}`}>{d}</span>
              ))}
            </div>
            <div className={`${s.card} ${s.cardNew}`}>
              <div>
                <div className={s.cTitle}>Beach Tennis · Nível B</div>
                <div className={s.cSub}>Ter 19:00 — 20:00 · Quadra 1</div>
              </div>
              <span className={s.okTag}>+ Turma criada</span>
            </div>
          </div>

          <div className={`${s.screen} ${active === 1 ? s.on : ''}`}>
            <div className={s.scLabel}>App do aluno</div>
            <div className={s.card}>
              <div>
                <div className={s.cTitle}>Beach Tennis · Avançado</div>
                <div className={s.cSub}>Ter 19:00 · Quadra 1 · resta 1 vaga</div>
              </div>
              <span className={s.okTag}>Agendado ✓</span>
            </div>
            <div className={s.hintRow}>1 crédito usado · reposição liberada</div>
          </div>

          <div className={`${s.screen} ${active === 2 ? s.on : ''}`}>
            <div className={s.scLabel}>Recepção · Check-in</div>
            <div className={s.card}>
              <div>
                <div className={s.cTitle}>Maria Souza</div>
                <div className={s.cSub}>via Wellhub · 18:57</div>
              </div>
              <span className={s.okTag}>Presença ✓</span>
            </div>
            <div className={s.hintRow}>Sem fila, sem digitar matrícula.</div>
          </div>

          <div className={`${s.screen} ${active === 3 ? s.on : ''}`}>
            <div className={s.scLabel}>Painel · Financeiro</div>
            <div className={s.finRow}>
              <div className={s.finBig}>R$ 1.240</div>
              <div className={s.finLbl}>entrou hoje</div>
            </div>
            <div className={s.bars}>
              <span style={{ height: '40%' }} /><span style={{ height: '65%' }} />
              <span style={{ height: '52%' }} /><span style={{ height: '80%' }} />
              <span style={{ height: '70%' }} /><span style={{ height: '95%' }} />
            </div>
            <div className={s.hintRow}>Inadimplência: 0 em aberto</div>
          </div>
        </div>
      </div>

      <div className={s.steps}>
        {STEPS.map((st, i) => (
          <button
            key={st.k}
            type="button"
            className={`${s.step} ${active === i ? s.stepOn : ''}`}
            onClick={() => setActive(i)}
            aria-label={`Passo ${i + 1}: ${st.k}`}
          >
            <span className={s.stepNum}>{i + 1}</span>
            <span className={s.stepText}>
              <strong>{st.k}</strong>
              <em>{st.d}</em>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
