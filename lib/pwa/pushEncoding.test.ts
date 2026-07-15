import { describe, it, expect } from 'vitest'
import { urlBase64ToUint8Array } from './pushEncoding'

describe('urlBase64ToUint8Array', () => {
  it('decodifica base64url para os bytes corretos', () => {
    // "Hello" em base64 padrão é "SGVsbG8=" → base64url sem padding "SGVsbG8"
    const out = urlBase64ToUint8Array('SGVsbG8')
    expect(Array.from(out)).toEqual([72, 101, 108, 108, 111])
  })

  it('trata os caracteres url-safe - e _', () => {
    // bytes [255, 255] → base64 "//8=" → base64url "__8"
    const out = urlBase64ToUint8Array('__8')
    expect(Array.from(out)).toEqual([255, 255])
  })
})
