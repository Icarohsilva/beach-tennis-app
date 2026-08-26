'use client'
// app/(admin)/admin/alunos/[id]/StudentIdentityCard.tsx
// Edição completa de identidade pelo admin — nome, telefone, gênero e (só
// para quem tem login) e-mail — mais o botão de mandar link de senha. Fica
// FORA do StudentProfileClient de propósito, no mesmo espírito do
// VacationPanel: aquele componente já carrega 20+ props, e identidade é um
// assunto fechado em si.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { updateStudentIdentity, sendPasswordResetLink } from '@/features/aulas/studentIdentityActions'
import type { Gender } from '@/types'

interface Props {
  studentId: string
  fullName: string
  phone: string | null
  gender: Gender | null
  /** null = cadastro gerenciado, sem login — não tem e-mail para editar. */
  email: string | null
}

export function StudentIdentityCard({ studentId, fullName, phone, gender, email }: Props) {
  const router = useRouter()
  const [name, setName] = useState(fullName)
  const [phoneValue, setPhoneValue] = useState(phone ?? '')
  const [genderValue, setGenderValue] = useState<Gender | ''>(gender ?? '')
  const [emailValue, setEmailValue] = useState(email ?? '')
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [sendingLink, setSendingLink] = useState<'whatsapp' | 'email' | null>(null)
  const [linkResult, setLinkResult] = useState<{ whatsappUrl?: string; emailSent?: boolean } | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)

  const hasLogin = email !== null

  function handleSave() {
    setSaved(false)
    setError(null)
    startTransition(async () => {
      const res = await updateStudentIdentity(studentId, {
        full_name: name,
        phone: phoneValue || null,
        gender: genderValue || null,
        ...(hasLogin ? { email: emailValue || null } : {}),
      })
      if (res.error) {
        setError(res.error)
        return
      }
      setSaved(true)
      router.refresh()
    })
  }

  function handleSendLink(channel: 'whatsapp' | 'email') {
    setLinkError(null)
    setLinkResult(null)
    setSendingLink(channel)
    startTransition(async () => {
      const res = await sendPasswordResetLink(studentId, channel)
      setSendingLink(null)
      if (res.error) {
        setLinkError(res.error)
        return
      }
      if (channel === 'whatsapp' && res.whatsappUrl) {
        window.open(res.whatsappUrl, '_blank', 'noopener,noreferrer')
        setLinkResult({ whatsappUrl: res.whatsappUrl })
      } else {
        setLinkResult({ emailSent: true })
      }
    })
  }

  return (
    <Card>
      <h2 className="text-base font-semibold text-white mb-3">Identidade</h2>
      <div className="space-y-3">
        <Input label="Nome completo" value={name} onChange={(e) => setName(e.target.value)} />
        <Input
          label="WhatsApp"
          type="tel"
          placeholder="(11) 99999-9999"
          value={phoneValue}
          onChange={(e) => setPhoneValue(e.target.value)}
        />
        <div>
          <label className="text-xs text-slate-400 block mb-1">Gênero</label>
          <select
            value={genderValue}
            onChange={(e) => setGenderValue(e.target.value as Gender | '')}
            className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">Não informado</option>
            <option value="M">Masculino</option>
            <option value="F">Feminino</option>
          </select>
        </div>
        {hasLogin ? (
          <Input
            label="E-mail (login)"
            type="email"
            value={emailValue}
            onChange={(e) => setEmailValue(e.target.value)}
          />
        ) : (
          <p className="text-xs text-slate-500">
            Cadastro sem login (gerenciado pela academia) — não tem e-mail para editar.
          </p>
        )}

        {error && <p className="text-red-400 text-xs">{error}</p>}
        {saved && <p className="text-green-400 text-xs">Dados salvos.</p>}

        <Button size="sm" loading={isPending && sendingLink === null} onClick={handleSave}>
          Salvar
        </Button>
      </div>

      {hasLogin && (
        <div className="mt-5 pt-4 border-t border-surface-border">
          <p className="text-xs text-slate-400 mb-2">
            Mandar link para o aluno definir/redefinir a própria senha:
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="flex-1"
              loading={sendingLink === 'whatsapp'}
              disabled={sendingLink !== null}
              onClick={() => handleSendLink('whatsapp')}
            >
              📱 WhatsApp
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="flex-1"
              loading={sendingLink === 'email'}
              disabled={sendingLink !== null}
              onClick={() => handleSendLink('email')}
            >
              ✉️ E-mail
            </Button>
          </div>
          {linkError && <p className="text-xs text-red-400 mt-1.5">{linkError}</p>}
          {linkResult?.whatsappUrl && (
            <p className="text-xs text-green-400 mt-1.5">
              Link aberto no WhatsApp.{' '}
              <a href={linkResult.whatsappUrl} target="_blank" rel="noopener noreferrer" className="underline">
                Abrir de novo
              </a>
            </p>
          )}
          {linkResult?.emailSent && <p className="text-xs text-green-400 mt-1.5">E-mail enviado.</p>}
        </div>
      )}
    </Card>
  )
}
