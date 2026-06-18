// app/page.tsx
import Link from 'next/link'
import Image from 'next/image'
import s from './landing.module.css'

export default function LandingPage() {
  return (
    <div className={s.page}>
      {/* NAV */}
      <nav className={s.nav}>
        <div className={`${s.wrap} ${s.navInner}`}>
          <div className={s.logo}>
            🏟️ Arena<span className={s.dot}>Hub</span>
          </div>
          <div className={s.navlinks}>
            <a href="#rec">Recursos</a>
            <a href="#alunos">Para alunos</a>
            <a href="#preco">Preço</a>
          </div>
          <div className={s.navcta}>
            <Link className={`${s.btn} ${s.btnGhost}`} href="/login">
              Entrar
            </Link>
            <Link className={`${s.btn} ${s.btnPrimary}`} href="/criar-academia">
              Criar conta grátis
            </Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <header className={s.hero}>
        <Image
          className={s.heroImg}
          src="/landing/hero.jpg"
          alt="Quadra de beach tennis ao entardecer"
          fill
          priority
          sizes="100vw"
        />
        <div className={s.heroOverlay} />
        <div className={s.floaters}>
          <span className={s.f1}>🎾</span>
          <span className={s.f2}>🏐</span>
          <span className={s.f3}>🏆</span>
          <span className={s.f4}>🥎</span>
        </div>
        <div className={`${s.wrap} ${s.heroInner}`}>
          <span className={s.eyebrow}>⚡ Plataforma para arenas e academias</span>
          <h1 className={s.heroTitle}>
            Sua arena <span className={s.hl}>cheia</span>. Sua gestão no{' '}
            <span className={s.hl}>automático</span>.
          </h1>
          <p className={s.heroSub}>
            Aulas, turmas por nível, créditos, check-in e pagamentos — tudo num app só. Feito
            para beach tennis, padel, futevôlei e vôlei de praia.
          </p>
          <div className={s.cluster}>
            <Link className={`${s.btn} ${s.btnPrimary} ${s.btnLg}`} href="/criar-academia">
              Criar conta grátis →
            </Link>
            <a className={`${s.btn} ${s.btnGhost} ${s.btnLg}`} href="#rec">
              ▶ Ver como funciona
            </a>
          </div>
          <div className={s.freebie}>
            ✅ <b>1º mês grátis</b> · sem cartão · configura em minutos
          </div>
        </div>
      </header>

      {/* SPORTS CHIPS */}
      <div className={s.sports}>
        <div className={`${s.wrap} ${s.sportsInner}`}>
          <span className={s.chip}>🎾 Beach Tennis</span>
          <span className={s.chip}>🟢 Padel</span>
          <span className={s.chip}>⚽ Futevôlei</span>
          <span className={s.chip}>🏐 Vôlei de Praia</span>
          <span className={s.chip}>🎾 Tênis</span>
          <span className={s.chip}>➕ e mais</span>
        </div>
      </div>

      {/* FEATURES */}
      <section className={s.blk} id="rec">
        <div className={s.wrap}>
          <div className={s.khead}>
            <div className={s.label}>Tudo num lugar só</div>
            <h2>O que o ArenaHub faz pela sua arena</h2>
            <p>Para de gerenciar aula no caderno e no grupo do WhatsApp.</p>
          </div>
          <div className={s.grid}>
            <div className={s.feat}>
              <div className={s.featIc}>📅</div>
              <h3>Grade &amp; agendamento</h3>
              <p>
                Turmas recorrentes por nível e horário. Aluno agenda, repõe e entra na fila de
                espera sozinho.
              </p>
            </div>
            <div className={s.feat}>
              <div className={s.featIc}>💳</div>
              <h3>Créditos &amp; reposição</h3>
              <p>Cancelou com 5h de antecedência? Crédito automático. Sem dor de cabeça com remarcação.</p>
            </div>
            <div className={s.feat}>
              <div className={s.featIc}>✅</div>
              <h3>Check-in integrado</h3>
              <p>Wellhub e TotalPass entram direto. Presença registrada sem fila na recepção.</p>
            </div>
            <div className={s.feat}>
              <div className={s.featIc}>📊</div>
              <h3>Financeiro</h3>
              <p>Mensalidades, pagamentos avulsos e inadimplência num painel claro. Você sabe quanto entra.</p>
            </div>
            <div className={s.feat}>
              <div className={s.featIc}>🏆</div>
              <h3>Torneios</h3>
              <p>Monte chaves, divulgue e inscreva alunos. Engaja a comunidade e movimenta a quadra.</p>
            </div>
            <div className={s.feat}>
              <div className={s.featIc}>💬</div>
              <h3>Comunidade</h3>
              <p>Feed da arena: avisos, fotos e ranking. Seus alunos viram torcida.</p>
            </div>
          </div>
        </div>
      </section>

      {/* STUDENT SPLIT */}
      <section className={`${s.blk} ${s.altBg}`} id="alunos">
        <div className={s.wrap}>
          <div className={s.split}>
            <div className={s.shot}>
              <Image
                className={s.shotImg}
                src="/landing/aluno.jpg"
                alt="Jogadora em quadra de areia"
                fill
                sizes="(max-width: 820px) 100vw, 50vw"
              />
              <div className={s.shotOverlay} />
            </div>
            <div>
              <div className={s.label}>Para quem joga</div>
              <h2>Achou um tempo pra jogar? Ache a arena.</h2>
              <p>
                Descubra arenas e academias perto de você, veja horários e{' '}
                <b>agende uma aula experimental gratuita</b> em segundos.
              </p>
              <div className={s.pin}>
                <span className={s.pinB}>📍</span> Busca por região e tipo de esporte
              </div>
              <div className={s.pin}>
                <span className={s.pinB}>🎾</span> Aula experimental sem compromisso
              </div>
              <div className={s.pin}>
                <span className={s.pinB}>⭐</span> Vê níveis, horários e a vibe da arena
              </div>
              <Link
                className={`${s.btn} ${s.btnPrimary} ${s.btnLg}`}
                href="/experimental"
                style={{ marginTop: 18 }}
              >
                Encontrar uma arena
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className={s.blk} id="preco">
        <div className={s.wrap}>
          <div className={s.price}>
            <h2>Comece de graça</h2>
            <div className={s.priceBig}>
              R$ 39,90<small> /mês</small>
            </div>
            <p>1º mês por nossa conta. Depois, preço único — sem taxa por aluno, sem surpresa.</p>
            <Link className={`${s.btn} ${s.btnPrimary} ${s.btnLg}`} href="/criar-academia">
              Criar conta grátis →
            </Link>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className={s.footer}>
        <div className={`${s.wrap} ${s.footerInner}`}>
          <div className={s.logo} style={{ fontSize: 16 }}>
            🏟️ Arena<span className={s.dot}>Hub</span>
          </div>
          <div>© 2026 ArenaHub · arenahub.pro</div>
        </div>
      </footer>
    </div>
  )
}
