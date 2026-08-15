'use client'
// components/pwa/VersionGate.tsx
// Faz a versão nova chegar em quem está com o app aberto.
//
// O problema que isto resolve NÃO é cache: este app não tem cache de service worker
// (public/sw.js só cuida de push; o handler de fetch é um no-op para o Chrome
// considerar o app instalável). Qualquer carregamento de página já traz a versão
// nova. O que segura código antigo é a janela do PWA que ficou dias em segundo plano
// — o JS já está na memória e nada força um reload.
//
// Por isso o gatilho principal é `visibilitychange`: quando o app volta a ficar
// visível depois de um tempo longe, é o momento certo para recarregar.
import { useCallback, useEffect, useRef, useState } from 'react'
import { APP_BUILD_ID, precisaRecarregar } from '@/lib/version'
import { UpdateBanner } from './UpdateBanner'

/** Não bate em /api/version mais de uma vez neste intervalo. */
const INTERVALO_MIN_MS = 5 * 60 * 1000

/**
 * Tempo em segundo plano a partir do qual a recarga é automática.
 *
 * Trocar de app por 20 segundos para conferir um WhatsApp NÃO é motivo para
 * recarregar: o professor pode estar com o formulário de nova turma meio preenchido,
 * ou o admin no meio de uma chamada, e o reload jogaria o trabalho fora. Meia hora
 * fora é outra história — é o caso do PWA esquecido aberto, e ninguém tem formulário
 * pendente ali. Abaixo desse tempo, o aviso aparece e quem decide é o usuário.
 */
const AUSENCIA_PARA_RECARGA_MS = 30 * 60 * 1000

/** Ronda para a aba que fica em primeiro plano e nunca dispara visibilitychange. */
const RONDA_MS = 30 * 60 * 1000

export function VersionGate() {
  const [novaVersao, setNovaVersao] = useState(false)
  const ultimaChecagem = useRef(0)
  const escondidoDesde = useRef<number | null>(null)

  const recarregar = useCallback(() => {
    window.location.reload()
  }, [])

  useEffect(() => {
    let cancelado = false

    async function checar(podeRecarregarSozinho: boolean) {
      const agora = Date.now()
      if (agora - ultimaChecagem.current < INTERVALO_MIN_MS) return
      ultimaChecagem.current = agora

      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        if (!res.ok || cancelado) return
        const dados = (await res.json()) as { buildId?: unknown }
        if (cancelado) return
        if (!precisaRecarregar(APP_BUILD_ID, dados.buildId)) return

        if (podeRecarregarSozinho) recarregar()
        else setNovaVersao(true)
      } catch {
        // Offline ou rota fora do ar: tenta na próxima. Um app que não consegue
        // saber a versão deve seguir funcionando normalmente.
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        escondidoDesde.current = Date.now()
        return
      }
      const saiuEm = escondidoDesde.current
      escondidoDesde.current = null
      const ausencia = saiuEm ? Date.now() - saiuEm : 0
      checar(ausencia >= AUSENCIA_PARA_RECARGA_MS)
    }

    document.addEventListener('visibilitychange', onVisibilityChange)

    // Aba que nunca é escondida (o admin que deixa o painel aberto o dia inteiro no
    // desktop) não dispararia `visibilitychange` nenhuma vez. Esta ronda cobre esse
    // caso — e nunca recarrega sozinha, porque quem está com a aba em primeiro plano
    // pode estar digitando: mostra o aviso e deixa a decisão com a pessoa.
    const ronda = setInterval(() => checar(false), RONDA_MS)

    return () => {
      cancelado = true
      clearInterval(ronda)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [recarregar])

  if (!novaVersao) return null
  return <UpdateBanner onReload={recarregar} />
}
