import { describe, it, expect } from 'vitest'
import { notificationSender } from './notificationSender'

describe('notificationSender', () => {
  it('mostra o nome da academia para admin_message', () => {
    expect(notificationSender('admin_message', 'Arena Beach')).toBe('Arena Beach')
  })

  it('cai em "Academia" se admin_message sem nome', () => {
    expect(notificationSender('admin_message', null)).toBe('Academia')
    expect(notificationSender('admin_message', '   ')).toBe('Academia')
  })

  it('mostra "Sistema" para os demais tipos', () => {
    expect(notificationSender('waitlist_offer', 'Arena Beach')).toBe('Sistema')
    expect(notificationSender('no_credit', null)).toBe('Sistema')
    expect(notificationSender('new_event', 'X')).toBe('Sistema')
  })
})
