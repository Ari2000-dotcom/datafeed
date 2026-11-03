import { useEffect, useRef } from "react"

/**
 * Flashes the element green or red for a moment when `value` ticks up or down: the one place
 * motion earns its keep here, because it tells the eye which number just changed. The first
 * value, and anyone who asked for reduced motion, gets no flash.
 */
export function useTickFlash<T extends HTMLElement>(value: number | undefined) {
  const ref = useRef<T>(null)
  const previous = useRef<number | undefined>(undefined)

  useEffect(() => {
    const el = ref.current
    const before = previous.current
    previous.current = value
    if (!el || value === undefined || before === undefined || value === before) return
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const tint = `color-mix(in oklch, var(${value > before ? "--up" : "--down"}) 32%, transparent)`
    el.animate([{ backgroundColor: tint }, { backgroundColor: "transparent" }], { duration: 650, easing: "ease-out" })
  }, [value])

  return ref
}
