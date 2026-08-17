// app/page.tsx
import Link from 'next/link'
import Image from 'next/image'
import s from './landing.module.css'
import { WhatsAppChat } from './_landing/WhatsAppChat'
import { Reveal } from './_landing/Reveal'
import { LiveDemo } from './_landing/LiveDemo'
import { StickyCta } from './_landing/StickyCta'
import { QuadraViva } from './_landing/QuadraViva'
import { LegalFooterLinks } from '@/components/ui/LegalFooterLinks'
import { CalendarClock, CreditCard, BadgeCheck, BarChart3, Trophy, MessagesSquare } from 'lucide-react'

const INSTAGRAM_URL = 'https://www.instagram.com/arenahub.app/'
const YOUTUBE_URL = 'https://www.youtube.com/@arenahub-app'
const LINKEDIN_URL = 'https://www.linkedin.com/company/arenahub-app/'

export default function LandingPage() {
  return (
    <div className={s.page}>
      {/* NAV */}
      <nav className={s.nav}>
        <div className={`${s.wrap} ${s.navInner}`}>
          <div className={s.logo}>
            <Image
              src="/brand/arenahub-symbol-transparent.png"
              alt=""
              width={30}
              height={30}
              priority
              className={s.logoBadge}
            />
            Arena<span className={s.dot}>Hub</span>
          </div>
          <div className={s.navlinks}>
            <a href="#rec">Recursos</a>
            <a href="#como">Como funciona</a>
            <a href="#alunos">Para alunos</a>
            <a href="#preco">Preço</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className={s.navcta}>
            <a
              className={s.iconBtn}
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram do ArenaHub"
              title="Instagram"
            >
              <InstagramIcon />
            </a>
            <Link className={`${s.btn} ${s.btnGhost}`} href="/login">
              Entrar
            </Link>
            <Link className={`${s.btn} ${s.btnPrimary}`} href="/criar-academia">
              Criar grátis →
            </Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <header className={s.hero}>
        <div className={s.heroBg} />
        <QuadraViva className={s.heroQuadra} />
        <div className={s.heroNoise} />
        <div className={`${s.wrap} ${s.heroGrid}`}>
          <div>
            <span className={s.eyebrow}>
              <span className={s.pulse} /> Plataforma de gestão para academias e escolas esportivas
            </span>
            <h1 className={s.heroTitle}>
              O fim do <span className={s.hl}>caderninho</span> e do grupo de{' '}
              <span className={s.hl}>WhatsApp lotado</span>.
            </h1>
            <p className={s.heroSub}>
              Aulas, créditos, check-in, pagamentos e torneios. Tudo num app só. Sua agenda
              cheia no automático e seus alunos felizes sem precisar te mandar mensagem.
            </p>
            <div className={s.cluster}>
              <Link className={`${s.btn} ${s.btnPrimary} ${s.btnLg}`} href="/criar-academia">
                Criar conta grátis →
              </Link>
              <a className={`${s.btn} ${s.btnGhost} ${s.btnLg}`} href="#demo">
                ▶ Ver funcionando
              </a>
            </div>
            <div className={s.freebie}>
              <span className={s.freebieItem}><span className={s.check}>✓</span> <b>1º mês grátis</b></span>
              <span className={s.freebieItem}><span className={s.check}>✓</span> Sem cartão</span>
              <span className={s.freebieItem}><span className={s.check}>✓</span> Pronto em 5min</span>
            </div>
          </div>

          <div className={s.phoneWrap}>
            <span className={`${s.floatEmoji} ${s.f1}`}>🎾</span>
            <span className={`${s.floatEmoji} ${s.f2}`}>🏆</span>
            <span className={`${s.floatEmoji} ${s.f3}`}>🏐</span>
            <div className={s.phone}>
              <div className={s.phoneScreen}>
                <div className={s.phoneStatus}><span>9:41</span><span>📶 100%</span></div>

                <div className={`${s.glass} ${s.glassAccent}`}>
                  <div className={s.phGreet}>Bem-vindo</div>
                  <div className={s.phName}>Olá, Ícaro 👋</div>
                  <div className={s.phStats}>
                    <div className={s.phStat}><div className={s.phStatV}>12</div><div className={s.phStatL}>Créditos</div></div>
                    <div className={s.phStat}><div className={s.phStatV}>3</div><div className={s.phStatL}>Aulas/sem</div></div>
                    <div className={s.phStat}><div className={s.phStatV}>98%</div><div className={s.phStatL}>Presença</div></div>
                  </div>
                </div>

                <div className={s.phSectionLabel}>Aulas de hoje</div>

                <div className={s.glass}>
                  <div className={s.phRow}>
                    <div>
                      <div className={s.phTitle}>Funcional · Turma da manhã</div>
                      <div className={s.phTime}>19:00 às 20:00 · Espaço 1</div>
                    </div>
                    <span className={s.phPill}>confirmada</span>
                  </div>
                </div>

                <div className={s.glass}>
                  <div className={s.phRow}>
                    <div>
                      <div className={s.phTitle}>Funcional</div>
                      <div className={s.phTime}>20:15 às 21:00 · Espaço 2</div>
                    </div>
                    <span className={`${s.phPill} ${s.phPillBlue}`}>livre</span>
                  </div>
                </div>

                <div className={s.phSectionLabel}>Próximo torneio</div>

                <div className={`${s.glass} ${s.glassPurple}`}>
                  <div className={s.phTitle}>🏆 Open ArenaHub 2026</div>
                  <div className={s.phTime}>Sáb, 12 jul · Todos os níveis</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* SPORTS / SOCIAL PROOF */}
      <div className={s.proof}>
        <div className={`${s.wrap} ${s.proofInner}`}>
          <span className={s.proofText}>Feito para</span>
          <span className={s.chip}>🎾 Beach Tennis</span>
          <span className={s.chip}>🟢 Padel</span>
          <span className={s.chip}>🏋️ CrossFit</span>
          <span className={s.chip}>🧘 Pilates</span>
          <span className={s.chip}>⚽ Futebol</span>
          <span className={s.chip}>➕ e mais</span>
        </div>
      </div>

      {/* PROBLEMA */}
      <section className={`${s.blk} ${s.blkFade}`}>
        <div className={s.wrap}>
          <Reveal>
            <div className={s.khead}>
              <div className={s.labelUp}>Você reconhece isso?</div>
              <h2>Sua arena merece mais do que <span className={s.hl}>grupo de WhatsApp</span>.</h2>
              <p>Se algum desses já travou seu dia, a gente entende, e tem solução.</p>
            </div>
          </Reveal>
          <div className={s.problemGrid}>
            <div className={s.problemCard}>
              <div className={s.emoji}>😵‍💫</div>
              <h4>“Sobrou vaga? Posso ir?”</h4>
              <p>Você passa o dia respondendo as mesmas mensagens. E ainda perde aluno que ia repor.</p>
            </div>
            <div className={s.problemCard}>
              <div className={s.emoji}>📒</div>
              <h4>Caderno é caos</h4>
              <p>Quem pagou? Quem deve? Quem tem crédito? A planilha trava, o caderno some, a recepção pira.</p>
            </div>
            <div className={s.problemCard}>
              <div className={s.emoji}>💸</div>
              <h4>Inadimplência invisível</h4>
              <p>Cobrar mensalidade é desconfortável. Sem ferramenta, vira “depois eu te mando” que nunca vem.</p>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className={s.blk} id="rec">
        <div className={s.wrap}>
          <Reveal>
            <div className={s.khead}>
              <div className={s.labelUp}>Recursos</div>
              <h2>Tudo num app só. <span className={s.hl}>Feito pra arena.</span></h2>
              <p>Não é ERP genérico adaptado. É construído pra quem vive de agenda cheia.</p>
            </div>
          </Reveal>
          <Reveal>
            <div className={s.featGrid}>
              <div className={s.feat}>
                <div className={s.featIc}><CalendarClock size={26} strokeWidth={2} /></div>
                <h3>Grade inteligente</h3>
                <p>Turmas recorrentes por nível e horário. Aluno agenda, repõe e entra na fila de espera sozinho, sem você no meio.</p>
              </div>
              <div className={s.feat}>
                <div className={s.featIc}><CreditCard size={26} strokeWidth={2} /></div>
                <h3>Créditos &amp; reposição</h3>
                <p>Cancelou com 5h de antecedência? Crédito automático na conta do aluno. Sem dor de cabeça com remarcação.</p>
              </div>
              <div className={s.feat}>
                <div className={s.featIc}><BadgeCheck size={26} strokeWidth={2} /></div>
                <h3>Wellhub &amp; TotalPass</h3>
                <p>Check-in integrado, presença registrada sem fila. Sua recepção volta a respirar.</p>
              </div>
              <div className={s.feat}>
                <div className={s.featIc}><BarChart3 size={26} strokeWidth={2} /></div>
                <h3>Financeiro claro</h3>
                <p>Mensalidades por Pix, cartão recorrente ou avulso. Inadimplência num painel. Você sabe quanto entra.</p>
              </div>
              <div className={s.feat}>
                <div className={s.featIc}><Trophy size={26} strokeWidth={2} /></div>
                <h3>Torneios completos</h3>
                <p>Monte chaves, divulgue, cobre inscrição e gera ranking. Engaja a comunidade e movimenta a academia no fim de semana.</p>
              </div>
              <div className={s.feat}>
                <div className={s.featIc}><MessagesSquare size={26} strokeWidth={2} /></div>
                <h3>Comunidade no app</h3>
                <p>Feed da arena: avisos, fotos, ranking. Seus alunos viram torcida e fazem o marketing por você.</p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* COMO FUNCIONA */}
      <section className={`${s.blk} ${s.blkAlt}`} id="como">
        <div className={s.wrap}>
          <Reveal>
            <div className={s.khead}>
              <div className={s.labelUp}>Como funciona</div>
              <h2>Da inscrição à <span className={s.hl}>primeira aula</span> em 5 minutos.</h2>
            </div>
          </Reveal>
          <Reveal>
            <div className={s.steps}>
              <div className={s.step}>
                <div className={s.stepN}>1</div>
                <h3>Cria a conta</h3>
                <p>Cadastra a arena, os horários e os professores. 5 minutos. Sem cartão.</p>
              </div>
              <div className={s.step}>
                <div className={s.stepN}>2</div>
                <h3>Convida os alunos</h3>
                <p>Link único pra cada turma. Aluno baixa o app, escolhe a aula e tá dentro.</p>
              </div>
              <div className={s.step}>
                <div className={s.stepN}>3</div>
                <h3>Foca em jogar</h3>
                <p>O sistema cuida de agenda, cobrança e reposição. Você cuida da bola.</p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* DEMO INTERATIVO */}
      <section className={`${s.blk} ${s.blkFade}`} id="demo">
        <div className={s.wrap}>
          <Reveal>
            <div className={s.khead}>
              <div className={s.labelUp}>Veja rodando</div>
              <h2>A arena inteira <span className={s.hl}>num fluxo só</span>.</h2>
              <p>Do agendamento ao dinheiro no painel, sem caderno, sem WhatsApp.</p>
            </div>
          </Reveal>
          <LiveDemo />
        </div>
      </section>

      {/* PARA ALUNOS */}
      <section className={s.blk} id="alunos">
        <div className={s.wrap}>
          <Reveal>
            <div className={s.split}>
              <div
                className={s.shot}
                style={{
                  backgroundImage:
                    "linear-gradient(180deg, rgba(4,6,13,0.2), rgba(4,6,13,0.55)), url('/landing/aluno.jpg')",
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              >
                <div className={`${s.floatingStat} ${s.fsTop}`}>
                  <div className={s.fsV}>Grátis</div>
                  <div className={s.fsL}>Aula experimental</div>
                </div>
                <div className={`${s.floatingStat} ${s.fsBot}`}>
                  <div className={s.fsV}>Sem</div>
                  <div className={s.fsL}>Compromisso</div>
                </div>
              </div>
              <div className={s.splitContent}>
                <div className={s.labelUp}>Para quem joga</div>
                <h2>Achou um tempo? <span className={s.hl}>Achou uma arena.</span></h2>
                <p>
                  Descobre arenas perto de você, vê horários, vibe e nível. Marca uma{' '}
                  <b>aula experimental gratuita</b> em segundos. Direto pelo app.
                </p>
                <div className={s.pin}><span className={s.pinIc}>📍</span> Busca por região e esporte</div>
                <div className={s.pin}><span className={s.pinIc}>🎾</span> Aula experimental sem compromisso</div>
                <div className={s.pin}><span className={s.pinIc}>⭐</span> Vê nível, horários e a galera da arena</div>
                <div className={s.pin}><span className={s.pinIc}>🏆</span> Encontra torneios abertos na sua região</div>
                <div style={{ marginTop: 24 }}>
                  <Link className={`${s.btn} ${s.btnPrimary} ${s.btnLg}`} href="/arenas">
                    Encontrar uma arena →
                  </Link>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* PRICING */}
      <section className={s.blk} id="preco">
        <div className={s.wrap}>
          <Reveal>
            <div className={s.khead}>
              <div className={s.labelUp}>Preço</div>
              <h2>Um preço. <span className={s.hl}>Sem pegadinha.</span></h2>
              <p>Sem taxa por aluno. Sem cobrança por funcionalidade. Sem surpresa na fatura.</p>
            </div>
          </Reveal>
          <div className={s.priceCard}>
            <div className={s.priceBadge}>🎁 1º mês grátis</div>
            <h2>Arena profissional</h2>
            <div className={s.priceBig}>R$ 49,90<small> /mês</small></div>
            <div className={s.priceAnchor}>menos que uma aula avulsa · ~R$ 1,66/dia</div>
            <p>Depois do mês grátis. Cancele quando quiser.</p>
            <p className={s.priceFinePrint}>
              Preço promocional de lançamento. Reajustes futuros seguem o critério do{' '}
              <Link href="/legal/contrato-assinatura-saas">Contrato de Assinatura</Link>, sempre com
              aviso prévio.
            </p>
            <div className={s.priceFeats}>
              <span className={s.priceFeat}>✓ Alunos ilimitados</span>
              <span className={s.priceFeat}>✓ Turmas ilimitadas</span>
              <span className={s.priceFeat}>✓ Wellhub &amp; TotalPass</span>
              <span className={s.priceFeat}>✓ Torneios</span>
              <span className={s.priceFeat}>✓ Pix automático</span>
              <span className={s.priceFeat}>✓ Suporte por WhatsApp</span>
            </div>
            <div className={s.priceReassure}>
              <span>✓ 1º mês grátis</span>
              <span>✓ Sem cartão</span>
              <span>✓ Cancela em 1 clique</span>
            </div>
            <Link className={`${s.btn} ${s.btnPrimary} ${s.btnLg}`} href="/criar-academia">
              Criar conta grátis →
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className={`${s.blk} ${s.blkAlt}`} id="faq">
        <div className={s.wrap}>
          <Reveal>
            <div className={s.khead}>
              <div className={s.labelUp}>Perguntas</div>
              <h2>Antes de criar a conta.</h2>
            </div>
          </Reveal>
          <div className={s.faq}>
            <details className={s.faqItem}>
              <summary>Preciso instalar alguma coisa?</summary>
              <p>Não. Funciona em qualquer celular ou computador, direto pelo navegador. Tem versão para instalar como app (PWA) se você quiser.</p>
            </details>
            <details className={s.faqItem}>
              <summary>E se eu desistir? Cobra cancelamento?</summary>
              <p>Zero taxa de cancelamento. Você cancela com um clique no painel. Seus dados continuam disponíveis por um período após o cancelamento. Para reativar ou solicitar exportação, é só falar com a gente.</p>
            </details>
            <details className={s.faqItem}>
              <summary>Funciona pra qualquer modalidade?</summary>
              <p>Sim. Beach tennis, padel, futevôlei, crossfit, pilates, funcional, futebol, luta e mais. Qualquer academia ou escola que dá aulas e tem alunos.</p>
            </details>
            <details className={s.faqItem}>
              <summary>Como funciona o Wellhub e TotalPass?</summary>
              <p>A gente recebe o check-in direto deles. Não tem fila na recepção, não tem digitação de matrícula. Plugar e usar.</p>
            </details>
            <details className={s.faqItem}>
              <summary>Preciso migrar os dados do meu caderno?</summary>
              <p>Não precisa digitar tudo de uma vez. Você cadastra as turmas e vai adicionando os alunos conforme eles entram pelo link, sem planilha, sem migração forçada.</p>
            </details>
            <details className={s.faqItem}>
              <summary>Meus alunos vão conseguir usar sozinhos?</summary>
              <p>Sim. O aluno recebe um link, entra em segundos e já vê as aulas, créditos e o próximo torneio. Sem manual, sem treinamento. É feito pra quem só quer jogar.</p>
            </details>
            <details className={s.faqItem}>
              <summary>Funciona sem internet boa no local?</summary>
              <p>Funciona. O app é leve e o check-in do Wellhub/TotalPass chega direto pra gente. Mesmo com sinal fraco no local, a presença é registrada sem fila na recepção.</p>
            </details>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className={s.finalCta} data-final-cta>
        <div className={s.finalCtaBg} />
        <div className={s.wrap}>
          <h2>Sua arena lotada começa <span className={s.hl}>hoje</span>.</h2>
          <p>1º mês grátis. Sem cartão. 5 minutos pra configurar. Depois disso, é só ver a agenda encher.</p>
          <div className={s.cluster}>
            <Link className={`${s.btn} ${s.btnPrimary} ${s.btnLg}`} href="/criar-academia">
              Criar conta grátis →
            </Link>
            <a
              className={`${s.btn} ${s.btnGhost} ${s.btnLg}`}
              href={`https://wa.me/5531996313913?text=${encodeURIComponent('Olá! Vim pelo site do ArenaHub e queria conversar.')}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Falar com a gente
            </a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className={s.footer}>
        <div className={`${s.wrap} ${s.footerInner}`}>
          <div className={s.footerLeft}>
            <div className={s.logo} style={{ fontSize: 16 }}>
              <Image
                src="/brand/arenahub-symbol-transparent.png"
                alt=""
                width={26}
                height={26}
                className={s.logoBadge}
              />
              Arena<span className={s.dot}>Hub</span>
            </div>
            <span>© 2026 · arenahub.website</span>
          </div>
          <div className={s.footerSocials}>
            <a
              className={`${s.footerSoc} ${s.ig}`}
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram"
              title="Instagram"
            >
              <InstagramIcon />
            </a>
            <a
              className={`${s.footerSoc} ${s.yt}`}
              href={YOUTUBE_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="YouTube"
              title="YouTube"
            >
              <YouTubeIcon />
            </a>
            <a
              className={`${s.footerSoc} ${s.li}`}
              href={LINKEDIN_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="LinkedIn"
              title="LinkedIn"
            >
              <LinkedInIcon />
            </a>
            <a
              className={`${s.footerSoc} ${s.wa}`}
              href={`https://wa.me/5531996313913?text=${encodeURIComponent('Olá! Vim pelo site do ArenaHub.')}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="WhatsApp"
              title="WhatsApp"
            >
              <WhatsAppIconSmall />
            </a>
          </div>
        </div>
        <div className={s.wrap}>
          <LegalFooterLinks className="mt-4" />
        </div>
      </footer>

      {/* Floating chat WhatsApp */}
      <WhatsAppChat />
      <StickyCta />
    </div>
  )
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  )
}

function YouTubeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.376.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.376-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814ZM9.545 15.568V8.432L15.818 12l-6.273 3.568Z" />
    </svg>
  )
}

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286ZM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124ZM7.114 20.452H3.558V9h3.556v11.452ZM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003Z" />
    </svg>
  )
}

function WhatsAppIconSmall() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  )
}
