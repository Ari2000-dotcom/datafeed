import type { ReactNode, SVGProps } from "react"

import { cn } from "@/lib/utils"

/*
 * The app's icons, in TradingView's manner: hairline outlines, every straight line one pixel wide on
 * a pixel's centre, so at 1x it is one solid row or column of pixels rather than two grey ones.
 *
 * Two families. The chart toolbar's icons (chart types, the OI views, the tools) are drawn on a 28px
 * grid at 1:1, the glyph in the middle 20px or so, and take no size. The small ones (menus, fields,
 * chips) are drawn for the size they are asked at, the viewBox the box in pixels, so a 14px close is
 * drawn for 14px and not shrunk from a bigger drawing.
 */

type Extra = Omit<SVGProps<SVGSVGElement>, "width" | "height" | "viewBox" | "children" | "ref">
type Small = Readonly<{ size?: number } & Extra>
type Big = Readonly<Extra>

/** A 28px-grid icon: drawn 1:1, a 1px line. */
function Tv({ className, children, ...rest }: Readonly<{ children: ReactNode } & Extra>) {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden className={cn("shrink-0", className)} {...rest}>
      {children}
    </svg>
  )
}

/** A small icon's box: the viewBox is the box in pixels, so coordinates are pixels. */
function Box({ size, className, weight = 1, children, ...rest }: Readonly<{ size: number; weight?: number; children: ReactNode } & Extra>) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" stroke="currentColor" strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cn("shrink-0", className)} {...rest}>
      {children}
    </svg>
  )
}

/* -- small ------------------------------------------------------------------------------------ */

export function SearchIcon({ size = 16, className, ...rest }: Small) {
  // A whole-pixel centre and a half-pixel radius: the ring's four sides each land on one pixel.
  const r = Math.round(size * 0.3) + 0.5
  const c = r + 1.5
  const from = c + r * Math.SQRT1_2
  const to = size - 1.5
  return (
    <Box size={size} className={className} {...rest}>
      <circle cx={c} cy={c} r={r} />
      <path d={`M${from} ${from}L${to} ${to}`} />
    </Box>
  )
}

export function CheckIcon({ size = 16, className, ...rest }: Small) {
  const at = (f: number) => Math.round(size * f * 2) / 2
  return (
    <Box size={size} className={className} weight={1.5} {...rest}>
      <path d={`M${at(0.2)} ${at(0.52)}L${at(0.42)} ${at(0.74)}L${at(0.82)} ${at(0.3)}`} />
    </Box>
  )
}

export function ChevronDownIcon({ size = 16, className, ...rest }: Small) {
  const x = Math.floor((size - 6) / 2) + 0.5
  const y = Math.floor((size - 3) / 2)
  return (
    <Box size={size} className={className} weight={1.5} {...rest}>
      <path d={`M${x} ${y}l3 3 3-3`} />
    </Box>
  )
}

export function ChevronUpIcon({ size = 16, className, ...rest }: Small) {
  const x = Math.floor((size - 6) / 2) + 0.5
  const y = Math.floor((size - 3) / 2) + 3
  return (
    <Box size={size} className={className} weight={1.5} {...rest}>
      <path d={`M${x} ${y}l3-3 3 3`} />
    </Box>
  )
}

export function ChevronRightIcon({ size = 16, className, ...rest }: Small) {
  const x = Math.floor((size - 3) / 2)
  const y = Math.floor((size - 6) / 2) + 0.5
  return (
    <Box size={size} className={className} weight={1.5} {...rest}>
      <path d={`M${x} ${y}l3 3-3 3`} />
    </Box>
  )
}

export function CloseIcon({ size = 14, className, ...rest }: Small) {
  const a = Math.round(size * 0.28) + 0.5
  const b = size - a
  return (
    <Box size={size} className={className} weight={1.25} {...rest}>
      <path d={`M${a} ${a}L${b} ${b}M${b} ${a}L${a} ${b}`} />
    </Box>
  )
}

/** A ring round an exclamation mark: the stem one column on the middle pixel, the dot on whole pixels. */
export function AlertIcon({ size = 16, className, ...rest }: Small) {
  const c = size / 2
  return (
    <Box size={size} className={className} {...rest}>
      <circle cx={c} cy={c} r={size / 2 - 1.5} />
      <path d={`M${c} ${size * 0.3}V${size * 0.57}`} />
      <path d={`M${c} ${size * 0.72}v0.01`} strokeWidth="1.75" />
    </Box>
  )
}

/** Three dots in a column, one pixel apart from the edge: a menu of the less used. */
export function MoreIcon({ size = 16, className, ...rest }: Small) {
  const c = size / 2
  return (
    <Box size={size} className={className} {...rest}>
      <g fill="currentColor" stroke="none">
        <circle cx={c} cy={size * 0.25} r="1.1" />
        <circle cx={c} cy={c} r="1.1" />
        <circle cx={c} cy={size * 0.75} r="1.1" />
      </g>
    </Box>
  )
}

/** A quarter-turn arrow: try again. */
export function RetryIcon({ size = 16, className, ...rest }: Small) {
  return (
    <Box size={size} className={className} {...rest}>
      <path d={`M${size - 2.5} ${size / 2 + 0.5}A${size / 2 - 2.5} ${size / 2 - 2.5} 0 1 1 ${size - 4.5} ${size / 2 - 3.5}`} />
      <path d={`M${size - 3.5} 2.5v3.5h-3.5`} />
    </Box>
  )
}

/** The spinner: an arc, turned by CSS. */
export function SpinnerIcon({ size = 16, className, ...rest }: Small) {
  return (
    <Box size={size} className={cn("animate-spin", className)} weight={1.5} {...rest}>
      <path d={`M${size / 2} 2a${size / 2 - 2} ${size / 2 - 2} 0 1 0 ${size / 2 - 2} ${size / 2 - 2}`} />
    </Box>
  )
}

/** The theme: a disc half lit. */
export function ToneIcon({ size = 16, className, ...rest }: Small) {
  const c = size / 2
  return (
    <Box size={size} className={className} {...rest}>
      <circle cx={c} cy={c} r={size / 2 - 2} />
      <path d={`M${c} 2a${size / 2 - 2} ${size / 2 - 2} 0 0 1 0 ${size - 4}z`} fill="currentColor" stroke="none" />
    </Box>
  )
}

/** Rename: a pencil, drawn for 14px. */
export function PencilIcon({ className, ...rest }: Extra) {
  return (
    <Box size={14} className={className} {...rest}>
      <path d="M2.5 11.5 3.2 8.6 9.6 2.2a1.1 1.1 0 0 1 1.6 0l.6.6a1.1 1.1 0 0 1 0 1.6L5.4 10.8z" />
      <path d="M8.4 3.4l2.2 2.2" />
    </Box>
  )
}

/** Delete: a bin, drawn for 14px. */
export function TrashIcon({ className, ...rest }: Extra) {
  return (
    <Box size={14} className={className} {...rest}>
      <path d="M2.5 3.5h9M5.5 3.5v-1h3v1" />
      <path d="M3.5 3.5l.5 8h6l.5-8" />
      <path d="M5.8 5.8v3.7M8.2 5.8v3.7" />
    </Box>
  )
}

/* -- chart types, as TradingView's chart-type button pictures them ------------------------------ */

export const OhlcBarsIcon = ({ className, ...rest }: Big) => (
  <Tv className={className} {...rest}>
    <path d="M9.5 6v16M6 10.5h3M10 17.5h3" />
    <path d="M18.5 8v16M15 19.5h3M19 12.5h3" />
  </Tv>
)

export const CandlesIcon = ({ className, ...rest }: Big) => (
  <Tv className={className} {...rest}>
    <path d="M9.5 5v4M9.5 19v4M18.5 7v4M18.5 20v4" />
    <rect x="7.5" y="9.5" width="4" height="9" fill="currentColor" />
    <rect x="16.5" y="11.5" width="4" height="8" />
  </Tv>
)

export const HollowCandlesIcon = ({ className, ...rest }: Big) => (
  <Tv className={className} {...rest}>
    <path d="M9.5 5v4M9.5 19v4M18.5 7v4M18.5 20v4" />
    <rect x="7.5" y="9.5" width="4" height="9" />
    <rect x="16.5" y="11.5" width="4" height="8" />
  </Tv>
)

export const HighLowIcon = ({ className, ...rest }: Big) => (
  <Tv className={className} {...rest}>
    <rect x="7.5" y="6.5" width="4" height="12" />
    <rect x="16.5" y="10.5" width="4" height="12" />
  </Tv>
)

export const LineChartIcon = ({ className, ...rest }: Big) => (
  <Tv className={className} {...rest}>
    <path d="m4.5 19.5 5-6.5 4.5 4 5-8.5 4.5 5" strokeLinejoin="round" />
  </Tv>
)

export const StepLineIcon = ({ className, ...rest }: Big) => (
  <Tv className={className} {...rest}>
    <path d="M4 19.5h5.5v-6h5v3h5v-8H24" />
  </Tv>
)

export const AreaChartIcon = ({ className, ...rest }: Big) => (
  <Tv className={className} {...rest}>
    <path d="M4.5 18.5 9.5 12l4.5 4 5-8.5 4.5 5V23.5h-19z" fill="currentColor" stroke="none" opacity="0.22" />
    <path d="m4.5 18.5 5-6.5 4.5 4 5-8.5 4.5 5" strokeLinejoin="round" />
  </Tv>
)

export const BaselineIcon = ({ className, ...rest }: Big) => (
  <Tv className={className} {...rest}>
    <path d="M4 14.5h20" strokeDasharray="2 2" opacity="0.6" />
    <path d="m4.5 18.5 4.5-8 4.5 6 4.5-10 2.5 9 3 3" strokeLinejoin="round" />
  </Tv>
)

/* -- the indicators menu and the OI profile's views ------------------------------------------- */

/** TradingView's "fx": set in type, so it is as sharp at 1x as the words beside it. */
export const IndicatorsIcon = ({ className }: Big) => (
  <span className={cn("inline-flex size-7 shrink-0 items-center justify-center text-[15px] leading-none font-semibold italic select-none", className)} aria-hidden>
    f<span className="text-[11px] not-italic">x</span>
  </span>
)

/*
 * The OI views as small profiles, in the chart's own colours: puts to the left of the strike axis,
 * calls to the right, three strikes. Bars are solid with 1px rounded ends; what is drawn differently
 * is what the view is about (shed OI as an outline, signed exposure as a delta).
 */
const CALL = "var(--chart-oi-call)"
const PUT = "var(--chart-oi-put)"
const OiSpine = () => <path d="M14 4.5v19" stroke="currentColor" opacity="0.5" />
function Bar({ x, y, w, color, hollow = false }: { x: number; y: number; w: number; color: string; hollow?: boolean }) {
  return hollow ? (
    <rect x={x + 0.5} y={y + 0.5} width={w - 1} height={3} rx={1} fill="none" stroke={color} />
  ) : (
    <rect x={x} y={y} width={w} height={4} rx={1} fill={color} stroke="none" />
  )
}

export const OiTotalIcon = ({ className, ...rest }: Big) => (
  <Tv className={className} {...rest}>
    <OiSpine />
    <Bar x={8} y={6} w={5.5} color={PUT} />
    <Bar x={14.5} y={6} w={8} color={CALL} />
    <Bar x={5} y={12} w={8.5} color={PUT} />
    <Bar x={14.5} y={12} w={6} color={CALL} />
    <Bar x={9} y={18} w={4.5} color={PUT} />
    <Bar x={14.5} y={18} w={9} color={CALL} />
  </Tv>
)

export const OiChangeIcon = ({ className, ...rest }: Big) => (
  <Tv className={className} {...rest}>
    <OiSpine />
    <Bar x={8} y={6} w={5.5} color={PUT} />
    <Bar x={14.5} y={6} w={6} color={CALL} hollow />
    <Bar x={6} y={12} w={7.5} color={PUT} hollow />
    <Bar x={14.5} y={12} w={8.5} color={CALL} />
    <Bar x={10} y={18} w={3.5} color={PUT} />
    <Bar x={14.5} y={18} w={5} color={CALL} />
  </Tv>
)

export const DeltaOiIcon = ({ className, ...rest }: Big) => (
  <Tv className={className} {...rest}>
    <path d="M17 4.5v19" stroke="currentColor" opacity="0.5" />
    <Bar x={17.5} y={6} w={6} color={CALL} />
    <Bar x={17.5} y={12} w={4} color={CALL} />
    <Bar x={13} y={18} w={3.5} color={PUT} />
    <path d="M3.5 15.5 8 7.5l4.5 8z" stroke="currentColor" strokeLinejoin="round" />
  </Tv>
)

/** The profile hidden: the eye, struck through. */
export const EyeOffIcon = ({ className, ...rest }: Big) => (
  <Tv className={className} {...rest}>
    <path d="M4.5 14C7 9.5 10.3 7.5 14 7.5s7 2 9.5 6.5c-2.5 4.5-5.8 6.5-9.5 6.5S7 18.5 4.5 14Z" strokeLinejoin="round" />
    <circle cx="14" cy="14" r="3.5" />
    <path d="M6.5 21.5 21.5 6.5" strokeLinecap="round" />
  </Tv>
)

/** The ATM straddle: its payoff, a V whose point sits on the strike, over the price axis. */
export const StraddleIcon = ({ className, ...rest }: Big) => (
  <Tv className={className} {...rest}>
    <path d="M4 21.5h20" opacity="0.55" />
    <path d="M14.5 18v6" opacity="0.55" />
    <path d="M6 6.5 14.5 18 23 6.5" strokeLinejoin="round" />
    <circle cx="14.5" cy="18" r="1.5" fill="currentColor" />
  </Tv>
)

/* -- tools ------------------------------------------------------------------------------------ */

export const ZoomInIcon = ({ className, ...rest }: Big) => (
  <Tv className={className} {...rest}>
    <circle cx="12.5" cy="12.5" r="6" />
    <path d="m17 17 5.5 5.5" strokeLinecap="round" />
    <path d="M10 12.5h5M12.5 10v5" />
  </Tv>
)

export const ZoomOutIcon = ({ className, ...rest }: Big) => (
  <Tv className={className} {...rest}>
    <circle cx="12.5" cy="12.5" r="6" />
    <path d="m17 17 5.5 5.5" strokeLinecap="round" />
    <path d="M10 12.5h5" />
  </Tv>
)

/** Back to the chart's default view: a turning arrow. */
export const ResetViewIcon = ({ className, ...rest }: Big) => (
  <Tv className={className} {...rest}>
    <path d="M21.1 14A7.1 7.1 0 1 1 19.5 9.5" />
    <path d="M19.5 4.5v5h-5" />
  </Tv>
)

export const CameraIcon = ({ className, ...rest }: Big) => (
  <Tv className={className} {...rest}>
    <rect x="4.5" y="8.5" width="19" height="14" rx="2" />
    <path d="m10.5 8.5 1.5-3h4l1.5 3" strokeLinejoin="round" />
    <circle cx="14" cy="15" r="4.5" />
  </Tv>
)

export const FullscreenOnIcon = ({ className, ...rest }: Big) => (
  <Tv className={className} {...rest}>
    <path d="M5.5 10.5v-3a2 2 0 0 1 2-2h3M17.5 5.5h3a2 2 0 0 1 2 2v3M22.5 17.5v3a2 2 0 0 1-2 2h-3M10.5 22.5h-3a2 2 0 0 1-2-2v-3" />
  </Tv>
)

export const FullscreenOffIcon = ({ className, ...rest }: Big) => (
  <Tv className={className} {...rest}>
    <path d="M10.5 5.5v3a2 2 0 0 1-2 2h-3M17.5 5.5v3a2 2 0 0 0 2 2h3M22.5 17.5h-3a2 2 0 0 0-2 2v3M5.5 17.5h3a2 2 0 0 1 2 2v3" />
  </Tv>
)
