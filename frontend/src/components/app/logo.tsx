import { cn } from "@/lib/utils"

/** The mark: a rounded square with an inverted V. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-6 shrink-0", className)} >
      <rect width="32" height="32" rx="7" className="fill-primary" />
      <path d="M8 24 16 7l8 17h-4.5L16 15.5 12.5 24z" className="fill-primary-foreground" />
    </svg>
  )
}
