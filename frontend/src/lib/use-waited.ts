import { useEffect, useState } from "react"

/** Whether this long has passed since mount: past it, a plain "no data" beats a skeleton that never resolves. */
export function useWaited(ms: number): boolean {
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), ms)
    return () => clearTimeout(t)
  }, [ms])
  return waited
}
