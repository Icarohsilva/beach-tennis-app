export interface CheckinProgress {
  target: number
  done: number
  remaining: number
  ahead: number
}

/** Progresso da meta mensal de check-ins. */
export function computeProgress(target: number, done: number): CheckinProgress {
  return {
    target,
    done,
    remaining: Math.max(target - done, 0),
    ahead: Math.max(done - target, 0),
  }
}
