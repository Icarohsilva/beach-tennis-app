'use client'
// app/(admin)/admin/torneios/[id]/EnrollParticipantCard.tsx
// Inscrição no balcão: o organizador digita quem entra, sem a pessoa passar
// pelo app antes. É o caso do torneio de rua — metade chega pelo Instagram,
// manda o nome no WhatsApp e paga por PIX na hora.
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { UserPlus } from 'lucide-react'
import { enrollExternalEntry, type EnrolledPerson } from '@/features/torneios/enrollActions'
import { buildAccessMessage } from '@/lib/torneios/contactMessage'
import { buildWhatsAppUrl } from '@/lib/utils/whatsappLink'

interface PersonFields {
  fullName: string
  email: string
  phone: string
  gender: '' | 'M' | 'F'
}

const EMPTY_PERSON: PersonFields = { fullName: '', email: '', phone: '', gender: '' }

interface Props {
  tournamentId: string
  tournamentName: string
  tournamentUrl: string
  orgName: string
  isDuplaFixa: boolean
}

export function EnrollParticipantCard({
  tournamentId,
  tournamentName,
  tournamentUrl,
  orgName,
  isDuplaFixa,
}: Props) {
  const [open, setOpen] = useState(false)
  const [player, setPlayer] = useState<PersonFields>(EMPTY_PERSON)
  const [partner, setPartner] = useState<PersonFields>(EMPTY_PERSON)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{
    entryStatus: 'confirmed' | 'waitlist'
    player: EnrolledPerson
    partner?: EnrolledPerson
  } | null>(null)
  const [isPending, startTransition] = useTransition()

  function reset() {
    setOpen(false)
    setPlayer(EMPTY_PERSON)
    setPartner(EMPTY_PERSON)
    setError(null)
    setDone(null)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await enrollExternalEntry({
        tournamentId,
        player: {
          fullName: player.fullName,
          email: player.email,
          phone: player.phone || undefined,
          gender: player.gender || null,
        },
        ...(isDuplaFixa
          ? {
              partner: {
                fullName: partner.fullName,
                email: partner.email,
                phone: partner.phone || undefined,
                gender: partner.gender || null,
              },
            }
          : {}),
      })
      if (result.error || !result.player) {
        setError(result.error ?? 'Erro ao inscrever. Tente novamente.')
        return
      }
      setDone({ entryStatus: result.entryStatus!, player: result.player, partner: result.partner })
    })
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} size="sm" variant="secondary">
        <UserPlus className="mr-1.5 h-4 w-4" />
        Inscrever participante
      </Button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {done ? (
          <ConfirmationView
            tournamentName={tournamentName}
            tournamentUrl={tournamentUrl}
            orgName={orgName}
            entryStatus={done.entryStatus}
            player={done.player}
            partner={done.partner}
            onClose={reset}
          />
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Inscrever participante</h2>
              <p className="mt-1 text-xs text-slate-400">
                {isDuplaFixa
                  ? 'Torneio de dupla fixa — informe os dois jogadores. A conta de cada um é criada na hora, se ainda não existir.'
                  : 'A conta é criada na hora com os dados abaixo, se ainda não existir.'}
              </p>
            </div>

            <PersonFieldset
              legend={isDuplaFixa ? 'Jogador 1' : 'Participante'}
              value={player}
              onChange={setPlayer}
              genderRequired={isDuplaFixa}
            />

            {isDuplaFixa && (
              <PersonFieldset
                legend="Jogador 2"
                value={partner}
                onChange={setPartner}
                genderRequired
              />
            )}

            {error && <p className="text-sm text-red-400">{error}</p>}

            <div className="flex gap-2">
              <Button type="submit" loading={isPending} className="flex-1">
                Inscrever
              </Button>
              <Button type="button" variant="ghost" onClick={reset}>
                Cancelar
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  )
}

function PersonFieldset({
  legend,
  value,
  onChange,
  genderRequired = false,
}: {
  legend: string
  value: PersonFields
  onChange: (v: PersonFields) => void
  /**
   * Dupla fixa: canPairUp() exige os dois gêneros conhecidos para validar a
   * formação da dupla, mesmo num torneio sem restrição de formação — é o que
   * identifica MM/MF/FF. Sem os dois, o servidor recusa a inscrição.
   */
  genderRequired?: boolean
}) {
  const set = (field: keyof PersonFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [field]: e.target.value })

  return (
    <fieldset className="space-y-3 rounded-lg border border-surface-border p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {legend}
      </legend>
      <Input label="Nome completo" value={value.fullName} onChange={set('fullName')} required />
      <Input label="E-mail" type="email" value={value.email} onChange={set('email')} required />
      <Input
        label="WhatsApp"
        type="tel"
        placeholder="(11) 99999-9999"
        value={value.phone}
        onChange={set('phone')}
      />
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-300">
          Gênero{genderRequired ? '' : ' (opcional)'}
        </label>
        <select
          value={value.gender}
          onChange={(e) => onChange({ ...value, gender: e.target.value as PersonFields['gender'] })}
          required={genderRequired}
          className="w-full rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="" disabled={genderRequired}>
            {genderRequired ? 'Selecione' : 'Não informar'}
          </option>
          <option value="M">Masculino</option>
          <option value="F">Feminino</option>
        </select>
        {genderRequired && (
          <p className="text-xs text-slate-500">Dupla fixa precisa do gênero dos dois para validar a categoria.</p>
        )}
      </div>
    </fieldset>
  )
}

function ConfirmationView({
  tournamentName,
  tournamentUrl,
  orgName,
  entryStatus,
  player,
  partner,
  onClose,
}: {
  tournamentName: string
  tournamentUrl: string
  orgName: string
  entryStatus: 'confirmed' | 'waitlist'
  player: EnrolledPerson
  partner?: EnrolledPerson
  onClose: () => void
}) {
  const people = partner ? [player, partner] : [player]

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">
        {entryStatus === 'confirmed' ? 'Inscrição confirmada!' : 'Na lista de espera'}
      </h2>
      <p className="text-sm text-slate-400">
        {entryStatus === 'waitlist'
          ? 'O torneio está com as vagas cheias — a dupla entrou na fila de espera.'
          : 'Manda o acesso pelo WhatsApp: o link já vem com o torneio, o login e a senha provisória.'}
      </p>

      <div className="space-y-3">
        {people.map((person) => {
          // A parte de cada um (dupla fixa cobra por atleta) vai junto na
          // mesma mensagem de acesso — sem isso o organizador manda o login e
          // esquece de avisar que falta pagar.
          const paymentNote =
            person.paymentUrl && person.pendingAmountCents
              ? `\n\nSua parte da inscrição é R$ ${(person.pendingAmountCents / 100).toFixed(2).replace('.', ',')}. Pague por aqui: ${person.paymentUrl}`
              : ''
          const waUrl = person.phone
            ? buildWhatsAppUrl(
                person.phone,
                buildAccessMessage({
                  toName: person.name,
                  tournamentName,
                  tournamentUrl,
                  email: person.email,
                  password: person.password ?? null,
                  orgName,
                }) + paymentNote,
              )
            : null
          return (
            <div key={person.id} className="rounded-lg border border-surface-border bg-surface p-3">
              <p className="text-sm font-medium text-white">{person.name}</p>
              <p className="text-xs text-slate-400">{person.email}</p>
              {person.password && (
                <p className="mt-1 text-xs text-slate-500">
                  Senha provisória:{' '}
                  <span className="font-mono text-brand-400">{person.password}</span>
                </p>
              )}
              {person.pendingAmountCents !== undefined && person.pendingAmountCents > 0 && (
                <p className="mt-1 text-xs text-yellow-400">
                  Pendente: R$ {(person.pendingAmountCents / 100).toFixed(2).replace('.', ',')}
                </p>
              )}
              {waUrl ? (
                <a
                  href={waUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#25D366] px-3 py-1.5 text-xs font-semibold text-[#0b1a12] transition-opacity hover:opacity-90"
                >
                  💬 Mandar acesso no WhatsApp
                </a>
              ) : (
                <p className="mt-2 text-xs text-amber-400">
                  Sem WhatsApp cadastrado — repasse o acesso por outro canal.
                </p>
              )}
            </div>
          )
        })}
      </div>

      <Button onClick={onClose} className="w-full">
        Fechar
      </Button>
    </div>
  )
}
