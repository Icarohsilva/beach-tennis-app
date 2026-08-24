import { describe, it, expect } from 'vitest'
import { selectPendingDocuments, type OrgDocumentSummary } from './pendingRules'

function doc(overrides: Partial<OrgDocumentSummary> = {}): OrgDocumentSummary {
  return {
    id: 'doc-1',
    title: 'Termo de uso',
    kind: 'ack',
    status: 'published',
    currentVersion: 1,
    ...overrides,
  }
}

describe('selectPendingDocuments', () => {
  it('documento published sem ack nenhum: pendente', () => {
    const result = selectPendingDocuments([doc()], [])
    expect(result).toHaveLength(1)
  })

  it('ack na versão corrente: sai da lista', () => {
    const result = selectPendingDocuments(
      [doc({ currentVersion: 2 })],
      [{ documentId: 'doc-1', version: 2 }],
    )
    expect(result).toEqual([])
  })

  it('ack na versão 1 NÃO libera a versão 2 — reassinatura forçada por bump de versão', () => {
    const result = selectPendingDocuments(
      [doc({ currentVersion: 2 })],
      [{ documentId: 'doc-1', version: 1 }],
    )
    expect(result).toHaveLength(1)
  })

  it('ack de outro documento não libera este', () => {
    const result = selectPendingDocuments(
      [doc({ id: 'doc-1' })],
      [{ documentId: 'doc-2', version: 1 }],
    )
    expect(result).toHaveLength(1)
  })

  it('documento draft não bloqueia', () => {
    const result = selectPendingDocuments([doc({ status: 'draft' })], [])
    expect(result).toEqual([])
  })

  it('documento archived não bloqueia', () => {
    const result = selectPendingDocuments([doc({ status: 'archived' })], [])
    expect(result).toEqual([])
  })

  it('vários documentos: só os sem ack corrente voltam', () => {
    const result = selectPendingDocuments(
      [doc({ id: 'doc-1' }), doc({ id: 'doc-2' }), doc({ id: 'doc-3', status: 'draft' })],
      [{ documentId: 'doc-1', version: 1 }],
    )
    expect(result.map((d) => d.id)).toEqual(['doc-2'])
  })
})
