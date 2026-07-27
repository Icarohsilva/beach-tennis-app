import { describe, it, expect } from 'vitest'
import { matchesIOS, matchesAndroid, matchesInAppBrowser } from './environment'

const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const UA_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const UA_INSTAGRAM = `${UA_IPHONE} Instagram 300.0.0.0.0`
const UA_FACEBOOK = `${UA_IPHONE} [FBAN/FBIOS;FBAV/450.0.0.0]`

describe('matchesIOS', () => {
  it('reconhece iPhone', () => {
    expect(matchesIOS(UA_IPHONE)).toBe(true)
  })
  it('não confunde Android com iOS', () => {
    expect(matchesIOS(UA_ANDROID)).toBe(false)
  })
  it('não confunde desktop com iOS', () => {
    expect(matchesIOS(UA_DESKTOP)).toBe(false)
  })
})

describe('matchesAndroid', () => {
  it('reconhece Android', () => {
    expect(matchesAndroid(UA_ANDROID)).toBe(true)
  })
  it('não confunde iPhone com Android', () => {
    expect(matchesAndroid(UA_IPHONE)).toBe(false)
  })
})

describe('matchesInAppBrowser', () => {
  it('reconhece o browser do Instagram', () => {
    expect(matchesInAppBrowser(UA_INSTAGRAM)).toBe(true)
  })
  it('reconhece o browser do Facebook', () => {
    expect(matchesInAppBrowser(UA_FACEBOOK)).toBe(true)
  })
  it('Safari puro não é in-app browser', () => {
    expect(matchesInAppBrowser(UA_IPHONE)).toBe(false)
  })
  it('Chrome no Android não é in-app browser', () => {
    expect(matchesInAppBrowser(UA_ANDROID)).toBe(false)
  })
})
