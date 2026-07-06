// lib/utils/siteUrl.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { getSiteUrl } from './siteUrl'

const ORIGINAL = process.env.NEXT_PUBLIC_SITE_URL

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
  else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL
})

describe('getSiteUrl', () => {
  it('usa o default quando a env está ausente', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL
    expect(getSiteUrl()).toBe('https://arenahub.website')
  })

  it('força https:// quando a env vem sem esquema', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'www.arenahub.website'
    expect(getSiteUrl()).toBe('https://www.arenahub.website')
  })

  it('remove barras finais', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://arenahub.website//'
    expect(getSiteUrl()).toBe('https://arenahub.website')
  })

  it('usa o default quando a env está vazia ou só espaços', () => {
    process.env.NEXT_PUBLIC_SITE_URL = ''
    expect(getSiteUrl()).toBe('https://arenahub.website')
    process.env.NEXT_PUBLIC_SITE_URL = '   '
    expect(getSiteUrl()).toBe('https://arenahub.website')
  })
})
