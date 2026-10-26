'use client'
// app/(admin)/admin/torneios/[id]/WhatsAppGroupCard.tsx
// Grupo do WhatsApp do torneio, sem mandar convite um por um:
//   • "Baixar contatos (.vcf)": abre no celular, salva todos como "ArenaHub
//     <nome>" de uma vez, e o WhatsApp deixa adicionar todo mundo ao grupo;
//   • "Baixar planilha": a lista com nome, WhatsApp, situação e pagamento;
//   • link do grupo: o inscrito vê "Entrar no grupo" na página do torneio.
// Não usa o "Enviar acesso", que gera senha nova a cada clique.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Contact, FileSpreadsheet, Link2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { updateTournamentWhatsAppGroup } from '@/features/torneios/configActions'
import { downloadXlsx } from '@/lib/utils/downloadXlsx'
import {
  buildGroupInviteMessage,
  contactsToSheet,
  contactsToVcard,
  phoneToE164,
  type TournamentContact,
} from '@/lib/torneios/whatsappGroup'

function fileSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'torneio'
}

export function WhatsAppGroupCard({
  tournamentId,
  tournamentName,
  orgName,
  groupUrl,
  contacts,
}: {
  tournamentId: string
  tournamentName: string
  orgName: string
  groupUrl: string | null
  contacts: TournamentContact[]
}) {
  const router = useRouter()
  const [url, setUrl] = useState(groupUrl ?? '')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()

  const confirmed = contacts.filter((c) => c.status === 'confirmed')
  const withPhone = confirmed.filter((c) => phoneToE164(c.phone))
  const withoutPhone = confirmed.filter((c) => !phoneToE164(c.phone))

  function downloadSheet() {
    downloadXlsx(contactsToSheet(contacts), `inscritos-${fileSlug(tournamentName)}.xlsx`)
  }

  function downloadVcard() {
    const vcf = contactsToVcard(contacts, tournamentName)
    if (!vcf) return
    const blobUrl = URL.createObjectURL(new Blob([vcf], { type: 'text/vcard;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = `contatos-${fileSlug(tournamentName)}.vcf`
    a.click()
    // Mesmo cuidado de downloadXlsx: o Safari do iPhone lê o blob depois do clique.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 40_000)
  }

  function save() {
    setError(null)
    setNotice(null)
    startSaving(async () => {
      const res = await updateTournamentWhatsAppGroup(tournamentId, url)
      if (res.error) { setError(res.error); return }
      setUrl(res.url ?? '')
      setNotice(res.url ? 'Salvo. Os inscritos já veem "Entrar no grupo" na página do torneio.' : 'Link removido.')
      router.refresh()
    })
  }

  async function copyInvite() {
    if (!groupUrl) return
    const text = buildGroupInviteMessage({ toName: '', tournamentName, orgName, groupUrl })
    try {
      await navigator.clipboard.writeText(text)
      setNotice('Convite copiado. Cole onde quiser mandar: grupo da arena, status ou lista de transmissão.')
    } catch {
      setError('Não deu para copiar. Copie o link do campo acima.')
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-white">Grupo do WhatsApp</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          {confirmed.length} inscrito(s), {withPhone.length} com WhatsApp.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Todos de uma vez</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" className="gap-1.5" onClick={downloadVcard} disabled={withPhone.length === 0}>
            <Contact className="h-3.5 w-3.5" aria-hidden />
            Baixar contatos (.vcf)
          </Button>
          <Button type="button" variant="secondary" size="sm" className="gap-1.5" onClick={downloadSheet} disabled={contacts.length === 0}>
            <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />
            Baixar planilha
          </Button>
        </div>
        <p className="text-xs text-slate-500">
          Abra o .vcf no celular e escolha salvar todos. Os contatos entram como &quot;ArenaHub nome&quot;:
          no grupo, toque em Adicionar participantes, busque &quot;ArenaHub&quot; e marque todos.
        </p>
        {withoutPhone.length > 0 && (
          <p className="text-xs text-amber-300">
            Sem WhatsApp no cadastro: {withoutPhone.map((c) => c.name).join(', ')}.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Link do grupo</p>
        <input
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setNotice(null) }}
          placeholder="https://chat.whatsapp.com/..."
          aria-label="Link de convite do grupo"
          className="w-full min-w-0 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none"
        />
        <p className="text-xs text-slate-500">
          No WhatsApp: grupo › Convidar via link › Copiar link. Salvo aqui, cada inscrito vê o botão
          &quot;Entrar no grupo&quot; na página do torneio e entra sozinho.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" loading={saving} onClick={save} disabled={url.trim() === (groupUrl ?? '')}>
            Salvar link
          </Button>
          {groupUrl && (
            <Button type="button" size="sm" variant="secondary" className="gap-1.5" onClick={copyInvite}>
              <Link2 className="h-3.5 w-3.5" aria-hidden />
              Copiar convite
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-green-400">{notice}</p>}
    </Card>
  )
}
