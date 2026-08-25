// features/documentos/actions.test.ts
// O que falha calado aqui: CPF inválido sendo aceito, documento de outra
// academia sendo confirmado, e o unique (user_id, document_id, version) não
// sendo respeitado na escrita (idempotência de assinar duas vezes).
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
  getActiveOrgId: vi.fn(),
  getAuthUser: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(() => new Map()),
}))

vi.mock('@/features/aulas/guardianQueries', () => ({
  listGuardianDependents: vi.fn().mockResolvedValue([]),
}))

import { acknowledgeDocument } from './actions'
import { createAdminClient, getActiveOrgId, getAuthUser } from '@/lib/supabase/server'
import { listGuardianDependents } from '@/features/aulas/guardianQueries'

const USER = { id: 'user-1' }
const ORG = 'org-1'

interface DocFixture {
  id: string
  organization_id: string
  kind: 'ack' | 'sign'
  status: 'draft' | 'published' | 'archived'
  current_version: number
}

function makeClient(doc: DocFixture | null, upsertError: { message: string } | null = null) {
  const upsert = vi.fn().mockResolvedValue({ error: upsertError })
  const from = vi.fn((table: string) => {
    if (table === 'org_documents') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: doc }),
          }),
        }),
      }
    }
    if (table === 'org_document_acks') {
      return { upsert }
    }
    throw new Error(`tabela não modelada: ${table}`)
  })
  return { client: { from } as unknown as ReturnType<typeof createAdminClient>, upsert }
}

const PUBLISHED_ACK: DocFixture = {
  id: 'doc-1',
  organization_id: ORG,
  kind: 'ack',
  status: 'published',
  current_version: 2,
}

const PUBLISHED_SIGN: DocFixture = {
  id: 'doc-2',
  organization_id: ORG,
  kind: 'sign',
  status: 'published',
  current_version: 1,
}

beforeEach(() => {
  vi.mocked(getAuthUser).mockResolvedValue(USER as never)
  vi.mocked(getActiveOrgId).mockResolvedValue(ORG)
  vi.mocked(listGuardianDependents).mockResolvedValue([])
})

describe('acknowledgeDocument', () => {
  it('sem usuário autenticado, recusa', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null)
    const { client } = makeClient(PUBLISHED_ACK)
    vi.mocked(createAdminClient).mockReturnValue(client)
    const res = await acknowledgeDocument('doc-1')
    expect(res.error).toBeTruthy()
  })

  it('sem academia ativa, recusa', async () => {
    vi.mocked(getActiveOrgId).mockResolvedValue(null)
    const { client } = makeClient(PUBLISHED_ACK)
    vi.mocked(createAdminClient).mockReturnValue(client)
    const res = await acknowledgeDocument('doc-1')
    expect(res.error).toBeTruthy()
  })

  it('documento inexistente, recusa', async () => {
    const { client } = makeClient(null)
    vi.mocked(createAdminClient).mockReturnValue(client)
    const res = await acknowledgeDocument('doc-1')
    expect(res.error).toBe('Documento não encontrado.')
  })

  it('documento de OUTRA academia, recusa mesmo autenticado na sua', async () => {
    const { client } = makeClient({ ...PUBLISHED_ACK, organization_id: 'org-outra' })
    vi.mocked(createAdminClient).mockReturnValue(client)
    const res = await acknowledgeDocument('doc-1')
    expect(res.error).toBe('Documento não pertence a esta academia.')
  })

  it('documento draft (não publicado), recusa', async () => {
    const { client } = makeClient({ ...PUBLISHED_ACK, status: 'draft' })
    vi.mocked(createAdminClient).mockReturnValue(client)
    const res = await acknowledgeDocument('doc-1')
    expect(res.error).toBe('Documento não está disponível.')
  })

  it("kind='ack' não exige CPF nem nome — grava com signed_name/signed_cpf nulos", async () => {
    const { client, upsert } = makeClient(PUBLISHED_ACK)
    vi.mocked(createAdminClient).mockReturnValue(client)
    const res = await acknowledgeDocument('doc-1')
    expect(res.error).toBeUndefined()
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ signed_name: null, signed_cpf: null, version: 2 }),
      { onConflict: 'user_id,document_id,version', ignoreDuplicates: true },
    )
  })

  it("kind='sign' com CPF inválido é recusado", async () => {
    const { client, upsert } = makeClient(PUBLISHED_SIGN)
    vi.mocked(createAdminClient).mockReturnValue(client)
    const res = await acknowledgeDocument('doc-2', { name: 'Fulano de Tal', cpf: '111.111.111-11' })
    expect(res.error).toBe('CPF inválido.')
    expect(upsert).not.toHaveBeenCalled()
  })

  it("kind='sign' sem nome completo é recusado", async () => {
    const { client, upsert } = makeClient(PUBLISHED_SIGN)
    vi.mocked(createAdminClient).mockReturnValue(client)
    const res = await acknowledgeDocument('doc-2', { name: 'Fu', cpf: '111.444.777-35' })
    expect(res.error).toBe('Informe o nome completo.')
    expect(upsert).not.toHaveBeenCalled()
  })

  it("kind='sign' com CPF válido grava nome e CPF (só dígitos)", async () => {
    const { client, upsert } = makeClient(PUBLISHED_SIGN)
    vi.mocked(createAdminClient).mockReturnValue(client)
    const res = await acknowledgeDocument('doc-2', { name: 'Fulano de Tal', cpf: '111.444.777-35' })
    expect(res.error).toBeUndefined()
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ signed_name: 'Fulano de Tal', signed_cpf: '11144477735' }),
      { onConflict: 'user_id,document_id,version', ignoreDuplicates: true },
    )
  })

  it('assinar de novo é idempotente — sempre passa ignoreDuplicates no unique de versão', async () => {
    const { client, upsert } = makeClient(PUBLISHED_ACK)
    vi.mocked(createAdminClient).mockReturnValue(client)
    await acknowledgeDocument('doc-1')
    await acknowledgeDocument('doc-1')
    expect(upsert).toHaveBeenCalledTimes(2)
    for (const call of upsert.mock.calls) {
      expect(call[1]).toEqual({ onConflict: 'user_id,document_id,version', ignoreDuplicates: true })
    }
  })

  it('erro do banco no upsert vira mensagem genérica', async () => {
    const { client } = makeClient(PUBLISHED_ACK, { message: 'boom' })
    vi.mocked(createAdminClient).mockReturnValue(client)
    const res = await acknowledgeDocument('doc-1')
    expect(res.error).toBe('Erro ao registrar. Tente novamente.')
  })
})
