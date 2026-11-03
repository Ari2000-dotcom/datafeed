import { useSyncExternalStore } from "react"

/** One clock for the whole page: a single interval, however many components show the time. */
let now = Date.now()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  now = Date.now()
  timer ??= setInterval(() => {
    now = Date.now()
    for (const l of listeners) l()
  }, 1000)
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0) {
      clearInterval(timer)
      timer = undefined
    }
  }
}

/** Epoch ms, refreshed every second. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now)
}
