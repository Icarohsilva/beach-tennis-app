export function notificationSender(type: string, orgName?: string | null): string {
  if (type === 'admin_message') return orgName?.trim() || 'Academia'
  return 'Sistema'
}
