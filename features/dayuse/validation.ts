// Pure validation utilities for day use slots
export function validateDayUseSlot(
  startTime: string,
  endTime: string,
  capacity = 1,
): { error?: string } {
  if (startTime >= endTime) return { error: 'Horário de fim deve ser depois do início' }
  if (capacity < 1) return { error: 'capacidade mínima é 1' }
  return {}
}
