import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendMock = vi.hoisted(() => vi.fn())

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock }
  },
}))

import { sendEmail } from './email'

describe('sendEmail', () => {
  beforeEach(() => {
    sendMock.mockReset()
    process.env.RESEND_API_KEY = 're_test_key'
    process.env.NOTIFICATIONS_FROM_EMAIL = 'Academia <no-reply@teste.com>'
  })

  it('fail-closed sem RESEND_API_KEY', async () => {
    delete process.env.RESEND_API_KEY
    await sendEmail({ to: 'aluno@x.com', subject: 'Oi', html: '<p>Oi</p>' })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('fail-closed sem NOTIFICATIONS_FROM_EMAIL', async () => {
    delete process.env.NOTIFICATIONS_FROM_EMAIL
    await sendEmail({ to: 'aluno@x.com', subject: 'Oi', html: '<p>Oi</p>' })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('envia com from configurado', async () => {
    sendMock.mockResolvedValueOnce({ data: { id: 'email-1' }, error: null })
    await sendEmail({ to: 'aluno@x.com', subject: 'Titulo', html: '<p>Corpo</p>' })
    expect(sendMock).toHaveBeenCalledWith({
      from: 'Academia <no-reply@teste.com>',
      to: 'aluno@x.com',
      subject: 'Titulo',
      html: '<p>Corpo</p>',
    })
  })

  it('erro do Resend vira excecao', async () => {
    sendMock.mockResolvedValueOnce({ data: null, error: { message: 'dominio nao verificado' } })
    await expect(
      sendEmail({ to: 'aluno@x.com', subject: 'Titulo', html: '<p>Corpo</p>' }),
    ).rejects.toThrow(/dominio nao verificado/)
  })
})
