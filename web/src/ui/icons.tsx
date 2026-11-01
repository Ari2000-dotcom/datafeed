import type { ReactNode } from "react";

/*
 * The page's icons, in TradingView's manner: hairline outlines, every straight line one pixel wide
 * on a pixel's centre, so at 1x it is one solid row or column of pixels rather than two grey ones.
 *
 * Two families. The desk's icons (tool bars, the rail, the title bar, chart types, the OI views)
 * are drawn on TradingView's 28px grid at 1:1, the glyph in the middle 20px or so. The small ones
 * (menus, chips, fields) are drawn for the size they are asked at, the viewBox the box in pixels,
 * so a 12px close is drawn for 12px, not shrunk from a bigger drawing.
 */

type P = Readonly<{ size?: number }>;

/** TradingView's grid: 28px, a 1px line, drawn 1:1. They take no size. */
function Tv({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
      {children}
    </svg>
  );
}

/** A small icon's box: the viewBox is the box in pixels, so coordinates are pixels. */
function Small({ size, children }: Readonly<{ size: number; children: ReactNode }>) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
      {children}
    </svg>
  );
}

/** The middle pixel of a box (the one just before the middle, in an even box). */
const midPixel = (size: number) => Math.floor((size - 1) / 2);

/* -- the small icons ------------------------------------------------------------------------- */

export const SearchIcon = ({ size = 14 }: P) => {
  // A whole-pixel centre and a half-pixel radius: the ring's four sides each land on one pixel.
  const r = Math.round(size * 0.3) + 0.5;
  const c = r + 1.5;
  const from = c + r * Math.SQRT1_2;
  const to = size - 1.5;
  return (
    <Small size={size}>
      <circle cx={c} cy={c} r={r} />
      <path d={`M${from} ${from}L${to} ${to}`} strokeLinecap="round" />
    </Small>
  );
};

/** A drop slot's arrow, 1:1 on a 13px grid, towards the side the dragged cell would take. */
export const DropArrowIcon = ({ where }: Readonly<{ where: "top" | "bottom" | "left" | "right" | "center" }>) => {
  const d = {
    top: "M6.5 11V2.5M3.5 5.5l3-3 3 3",
    bottom: "M6.5 2v8.5M3.5 7.5l3 3 3-3",
    left: "M11 6.5H2.5M5.5 3.5l-3 3 3 3",
    right: "M2 6.5h8.5M7.5 3.5l3 3-3 3",
    center: "",
  }[where];
  return (
    <Small size={13}>
      <path d={d} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </Small>
  );
};

/*
 * The container bar's icons are QuantDesk's, drawn the way lucide draws them (a 24 grid scaled to the
 * size asked, a 2 stroke, round ends), so the bar reads exactly as it does there: the "+" at 14,
 * the "⋯" at 16, a tab's mark at 13 with a 1.75 stroke, its close at 11. Shapes are lucide's own.
 */
function Lucide({ size, stroke = 2, children }: Readonly<{ size: number; stroke?: number; children: ReactNode }>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

/** A container kind's mark, on its tab (13, 1.75) and in the menus (14): QuantDesk's candlestick chart, delta triangle and straddle flask. */
export const KindIcon = ({ kind, size = 13 }: Readonly<{ kind: string; size?: number }>) => (
  <Lucide size={size} stroke={1.75}>
    {kind === "scrip" ? (
      <>
        <path d="M9 5v4" />
        <rect width="4" height="6" x="7" y="9" rx="1" />
        <path d="M9 15v2" />
        <path d="M17 3v2" />
        <rect width="4" height="8" x="15" y="5" rx="1" />
        <path d="M17 13v3" />
        <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      </>
    ) : kind === "deltaoi" ? (
      <path d="M13.73 4a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    ) : (
      <>
        <path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2" />
        <path d="M6.453 15h11.094" />
        <path d="M8.5 2h7" />
      </>
    )}
  </Lucide>
);

/** The "+" at a container's tabs: add another. */
export const BarPlusIcon = () => (
  <Lucide size={14}>
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </Lucide>
);

/** The "⋯" at a container's bar: its actions. */
export const MoreIcon = () => (
  <Lucide size={16}>
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
    <circle cx="5" cy="12" r="1" />
  </Lucide>
);

/** A tab's close, and "close this container" in the menu. */
export const TabCloseIcon = ({ size = 11 }: Readonly<{ size?: number }>) => (
  <Lucide size={size}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Lucide>
);

/** Fill the desk with this container: the corners pulled out. */
export const MaximizeIcon = () => (
  <Lucide size={14}>
    <path d="M8 3H5a2 2 0 0 0-2 2v3" />
    <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
    <path d="M3 16v3a2 2 0 0 0 2 2h3" />
    <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
  </Lucide>
);

/** Back to the whole desk: the corners pushed in. */
export const RestoreIcon = () => (
  <Lucide size={14}>
    <path d="M8 3v3a2 2 0 0 1-2 2H3" />
    <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
    <path d="M3 16h3a2 2 0 0 1 2 2v3" />
    <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
  </Lucide>
);

/** Rows: a frame cut across (split into rows, open below). */
export const SplitRowsIcon = () => (
  <Lucide size={14}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M3 12h18" />
  </Lucide>
);

/** Columns: a frame cut down (split into columns, open beside). */
export const SplitColumnsIcon = () => (
  <Lucide size={14}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M12 3v18" />
  </Lucide>
);

/** A drop slot's window: the dragged cell takes this chart's place. */
export const DropReplaceIcon = () => (
  <Small size={13}>
    <rect x="1.5" y="2.5" width="10" height="8" rx="1" />
    <path d="M1.5 5.5h10" />
  </Small>
);

export const CloseIcon = ({ size = 12 }: P) => {
  const a = Math.round(size * 0.22);
  const b = size - a;
  return (
    <Small size={size}>
      <path d={`M${a} ${a}L${b} ${b}M${b} ${a}L${a} ${b}`} strokeWidth="1.25" strokeLinecap="round" />
    </Small>
  );
};

export const CheckIcon = ({ size = 14 }: P) => {
  const at = (f: number) => Math.round(size * f * 2) / 2;
  return (
    <Small size={size}>
      <path d={`M${at(0.18)} ${at(0.52)}L${at(0.4)} ${at(0.74)}L${at(0.84)} ${at(0.28)}`} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </Small>
  );
};

/** Arms of the same length either side of the middle pixel, so the cross is centred on it. */
export const PlusIcon = ({ size = 12 }: P) => {
  const k = midPixel(size);
  const arm = Math.floor(size * 0.3);
  const c = k + 0.5;
  return (
    <Small size={size}>
      <path d={`M${k - arm} ${c}H${k + 1 + arm}M${c} ${k - arm}V${k + 1 + arm}`} />
    </Small>
  );
};

/** Drawn for 14px: the lid one whole row, the handle and the ribs whole columns. */
export const TrashIcon = ({ size = 14 }: P) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
    <path d="M1 3.5h12M5.5 3.5v-2h3v2M2.5 3.5l1 9h7l1-9M5.5 6v4M8.5 6v4" />
  </svg>
);

/*
 * Drawn 1:1 rather than on a grid: a 6×3 V with its ends and point on pixel centres at every size,
 * so at 1x it is two clean diagonals, not a scaled-down grey smear. Its box is only room.
 */
export const ChevronDownIcon = ({ size = 16 }: P) => {
  const x = Math.floor((size - 6) / 2) + 0.5;
  const y = Math.floor((size - 3) / 2);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={`M${x} ${y}l3 3 3-3`} />
    </svg>
  );
};

/**
 * A ring round an exclamation mark. Small, the stem is one column on the middle pixel; big (an
 * empty state's), it is two columns either side of the box's middle line. Either way it and the
 * dot sit on whole pixels.
 */
export const AlertIcon = ({ size = 14 }: P) => {
  const w = size > 18 ? 2 : 1;
  const c = w === 2 ? Math.floor(size / 2) : midPixel(size) + 0.5;
  const r = c - 1.5;
  return (
    <Small size={size}>
      <circle cx={c} cy={c} r={r} />
      <path d={`M${c} ${Math.round(c - r * 0.5)}V${Math.round(c + r * 0.2)}`} strokeWidth={w} />
      <rect x={c - w / 2} y={Math.round(c + r * 0.45)} width={w} height={w} fill="currentColor" stroke="none" />
    </Small>
  );
};

/** An empty chart's picture: axes and a line, drawn on the 28 grid. */
export const ChartIcon = ({ size = 28 }: P) => (
  <svg width={size} height={size} viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
    <path d="M5.5 4v18.5H24" />
    <path d="m9 18 4.5-5.5 3.5 3.5 6-7.5" strokeLinejoin="round" />
  </svg>
);

export function Spinner({ size = 16 }: P) {
  return (
    <svg className="mh-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M21 12a9 9 0 1 1-6.22-8.56" />
    </svg>
  );
}

/**
 * TradingView's "fx": the indicators menu. Set in type rather than drawn (`.mh-fx`): an italic
 * serif f and a small x in the page's face, hinted like the words beside it, so it is as sharp at
 * 1x as they are. A stroked f smears its slanted stem across two pixel columns there.
 */
export const IndicatorsIcon = () => (
  <span className="mh-fx" aria-hidden>
    <i>f</i>x
  </span>
);

/** A panel's close, 1:1 on a 12px grid: two strokes corner to corner through the centre. */
export const CloseThinIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden>
    <path d="m2.5 2.5 7 7m0-7-7 7" />
  </svg>
);

/** A side panel's dock button, 1:1 on a 12px grid: the grid's cell with its lower half marked off, where the panel goes. */
export const DockBelowIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
    <rect x="1.5" y="1.5" width="9" height="9" rx="1" />
    <path d="M1.5 6.5h9" />
  </svg>
);

/* -- the chart types, as TradingView's chart-type button pictures them ------------------------ */

export const OhlcBarsIcon = () => (
  <Tv>
    <path d="M9.5 6v16M6 10.5h3M10 17.5h3" />
    <path d="M18.5 8v16M15 19.5h3M19 12.5h3" />
  </Tv>
);

export const CandlesIcon = () => (
  <Tv>
    <path d="M9.5 5v4M9.5 19v4M18.5 7v4M18.5 20v4" />
    <rect x="7.5" y="9.5" width="4" height="9" fill="currentColor" />
    <rect x="16.5" y="11.5" width="4" height="8" />
  </Tv>
);

export const HollowCandlesIcon = () => (
  <Tv>
    <path d="M9.5 5v4M9.5 19v4M18.5 7v4M18.5 20v4" />
    <rect x="7.5" y="9.5" width="4" height="9" />
    <rect x="16.5" y="11.5" width="4" height="8" />
  </Tv>
);

export const LineChartIcon = () => (
  <Tv>
    <path d="m4.5 19.5 5-6.5 4.5 4 5-8.5 4.5 5" strokeLinejoin="round" />
  </Tv>
);

export const LineMarkersIcon = () => (
  <Tv>
    <path d="m6 19 4-5 4 3.5 5.5-8.5" strokeLinejoin="round" />
    <circle cx="5.5" cy="19.5" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="10" cy="14" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="14" cy="17.5" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="20" cy="9" r="1.5" fill="currentColor" stroke="none" />
  </Tv>
);

export const StepLineIcon = () => (
  <Tv>
    <path d="M4 19.5h5.5v-6h5v3h5v-8H24" />
  </Tv>
);

export const AreaChartIcon = () => (
  <Tv>
    <path d="M4.5 18.5 9.5 12l4.5 4 5-8.5 4.5 5V23.5h-19z" fill="currentColor" stroke="none" opacity="0.22" />
    <path d="m4.5 18.5 5-6.5 4.5 4 5-8.5 4.5 5" strokeLinejoin="round" />
  </Tv>
);

export const HlcAreaIcon = () => (
  <Tv>
    <path d="M4.5 12 9.5 7l4.5 3 5-5 4.5 3.5v9.5L19 15.5l-5 5-4.5-2-5 3.5z" fill="currentColor" stroke="none" opacity="0.22" />
    <path d="m4.5 12 5-5 4.5 3 5-5 4.5 3.5M4.5 22l5-3.5 4.5 2 5-5 4.5 2.5" strokeLinejoin="round" />
  </Tv>
);

export const BaselineIcon = () => (
  <Tv>
    <path d="M4 14.5h20" strokeDasharray="2 2" opacity="0.6" />
    <path d="m4.5 18.5 4.5-8 4.5 6 4.5-10 2.5 9 3 3" strokeLinejoin="round" />
  </Tv>
);

export const HighLowIcon = () => (
  <Tv>
    <rect x="7.5" y="6.5" width="4" height="12" />
    <rect x="16.5" y="10.5" width="4" height="12" />
  </Tv>
);

/* -- the OI profile's views: bars hanging off a right-hand axis, as they draw on the chart ------ */

/** The axis the bars hang from, at the glyph's right. */
const OiAxis = () => <path d="M22.5 5v18" opacity="0.55" />;

/** Total OI faint-outlined, today's addition filled at each bar's outer end. */
export const OiBothIcon = () => (
  <Tv>
    <OiAxis />
    <path d="M22.5 6.5h-10v3h10M22.5 12.5h-6v3h6M22.5 18.5h-14v3h14" />
    <g fill="currentColor" stroke="none">
      <rect x="12" y="6" width="5" height="4" />
      <rect x="16" y="12" width="3" height="4" />
      <rect x="8" y="18" width="6" height="4" />
    </g>
  </Tv>
);

/** Total OI alone. */
export const OiTotalIcon = () => (
  <Tv>
    <OiAxis />
    <path d="M22.5 6.5h-10v3h10M22.5 12.5h-6v3h6M22.5 18.5h-14v3h14" />
  </Tv>
);

/** Today's change alone: two strikes added (filled), one shed (an outline). */
export const OiChangeIcon = () => (
  <Tv>
    <OiAxis />
    <path d="M22.5 12.5h-10v3h10" />
    <g fill="currentColor" stroke="none">
      <rect x="16" y="6" width="7" height="4" />
      <rect x="18" y="18" width="5" height="4" />
    </g>
  </Tv>
);

/** Delta × OI: bars scaled by delta, with a delta mark under the shortest. */
export const DeltaOiIcon = () => (
  <Tv>
    <OiAxis />
    <path d="M22.5 6.5h-12v3h12M22.5 12.5h-7v3h7M22.5 18.5h-4v3h4" />
    <path d="M5 22.5 9 15.5l4 7z" strokeLinejoin="round" />
  </Tv>
);

/** A view's settings: three rails with a knob on each, TradingView's manner (hairlines on pixel centres). */
export const SlidersIcon = () => (
  <Tv>
    <path d="M5.5 7.5h2M13.5 7.5h9M5.5 14.5h9M20.5 14.5h2M5.5 21.5h4M15.5 21.5h7" />
    <circle cx="10.5" cy="7.5" r="3" />
    <circle cx="17.5" cy="14.5" r="3" />
    <circle cx="12.5" cy="21.5" r="3" />
  </Tv>
);

/** Hide the OI profile: the eye, struck through. */
export const EyeOffIcon = () => (
  <Tv>
    <path d="M4.5 14C7 9.5 10.3 7.5 14 7.5s7 2 9.5 6.5c-2.5 4.5-5.8 6.5-9.5 6.5S7 18.5 4.5 14Z" strokeLinejoin="round" />
    <circle cx="14" cy="14" r="3.5" />
    <path d="M6.5 21.5 21.5 6.5" strokeLinecap="round" />
  </Tv>
);

/* -- the desk's chrome: the tools bar, the rail, the title bar -------------------------------- */

/** The plain cursor: a cross with an open centre. */
export const CrosshairToolIcon = () => (
  <Tv>
    <path d="M13.5 4v7M13.5 16v7M4 13.5h7M16 13.5h7" />
  </Tv>
);

/** The magnet: the crosshair snaps to the bar's open, high, low or close. */
export const MagnetToolIcon = () => (
  <Tv>
    <path d="M6.5 22.5V12a7.5 7.5 0 0 1 15 0v10.5h-5V12a2.5 2.5 0 0 0-5 0v10.5z" />
    <path d="M6.5 18.5h5M16.5 18.5h5" />
  </Tv>
);

/** Measure: a ruler laid corner to corner. */
export const MeasureToolIcon = () => (
  <Tv>
    <g transform="rotate(-45 14 14)">
      <rect x="3.5" y="10.5" width="21" height="7" rx="1.5" />
      <path d="M8 10.5v3M11 10.5v4.5M14 10.5v3M17 10.5v4.5M20 10.5v3" />
    </g>
  </Tv>
);

export const ZoomInToolIcon = () => (
  <Tv>
    <circle cx="12.5" cy="12.5" r="6" />
    <path d="m17 17 5.5 5.5" strokeLinecap="round" />
    <path d="M10 12.5h5M12.5 10v5" />
  </Tv>
);

export const ZoomOutToolIcon = () => (
  <Tv>
    <circle cx="12.5" cy="12.5" r="6" />
    <path d="m17 17 5.5 5.5" strokeLinecap="round" />
    <path d="M10 12.5h5" />
  </Tv>
);

/** Back to the chart's default view: a turning arrow. */
export const ResetViewToolIcon = () => (
  <Tv>
    <path d="M21.1 14A7.1 7.1 0 1 1 19.5 9.5" />
    <path d="M19.5 4.5v5h-5" />
  </Tv>
);

export const CameraToolIcon = () => (
  <Tv>
    <rect x="4.5" y="8.5" width="19" height="14" rx="2" />
    <path d="m10.5 8.5 1.5-3h4l1.5 3" strokeLinejoin="round" />
    <circle cx="14" cy="15" r="4.5" />
  </Tv>
);

/** The option chain: a table, calls and puts either side of the strike column. */
export const ChainRailIcon = () => (
  <Tv>
    <rect x="4.5" y="5.5" width="19" height="17" rx="1.5" />
    <path d="M4.5 10.5h19M10.5 10.5v12M17.5 10.5v12" />
    <path d="M6 14.5h3M6 18.5h3M19 14.5h3M19 18.5h3" opacity="0.6" />
  </Tv>
);

/** Delta × OI: as the panel draws it, the calls' bars to the left of the strike axis, the puts' to the right. */
export const DeltaOiRailIcon = () => (
  <Tv>
    <path d="M13.5 4v20" />
    <path d="M13.5 6.5h8v3h-8M13.5 12.5h5v3h-5M13.5 18.5h3v3h-3" />
    <path d="M13.5 6.5h-3v3h3M13.5 12.5h-5v3h5M13.5 18.5h-8v3h8" />
  </Tv>
);

/** Every straddle on the desk, a row each: a list. */
export const ListRailIcon = () => (
  <Tv>
    <path d="M10 8.5h13M10 14.5h13M10 20.5h13" />
    <g fill="currentColor" stroke="none">
      <circle cx="6.5" cy="8.5" r="1.5" />
      <circle cx="6.5" cy="14.5" r="1.5" />
      <circle cx="6.5" cy="20.5" r="1.5" />
    </g>
  </Tv>
);

/** The ATM straddle: its payoff, the V crossing zero at the two breakevens. */
export const StraddleRailIcon = () => (
  <Tv>
    <path d="M4 15.5h20" opacity="0.55" />
    <path d="M5 6.5 14 21l9-14.5" strokeLinejoin="round" />
  </Tv>
);

/** The menu: three rules, each one whole row of pixels. */
export const MenuIcon = () => (
  <Tv>
    <path d="M5 8.5h18M5 13.5h18M5 18.5h18" />
  </Tv>
);

/** The canvas tones: a disc half lit. */
export const ToneIcon = () => (
  <Tv>
    <circle cx="14" cy="14" r="7.5" />
    <path d="M14 6.5a7.5 7.5 0 0 1 0 15z" fill="currentColor" stroke="none" />
  </Tv>
);

export const FullscreenOnIcon = () => (
  <Tv>
    <path d="M5.5 10.5v-3a2 2 0 0 1 2-2h3M17.5 5.5h3a2 2 0 0 1 2 2v3M22.5 17.5v3a2 2 0 0 1-2 2h-3M10.5 22.5h-3a2 2 0 0 1-2-2v-3" />
  </Tv>
);

export const FullscreenOffIcon = () => (
  <Tv>
    <path d="M10.5 5.5v3a2 2 0 0 1-2 2h-3M17.5 5.5v3a2 2 0 0 0 2 2h3M22.5 17.5h-3a2 2 0 0 0-2 2v3M5.5 17.5h3a2 2 0 0 1 2 2v3" />
  </Tv>
);

/**
 * A chart layout's picture, 1:1: the grid's outline with a 1px divider at every cell edge inside
 * it, each on a whole pixel, so the picker's pictures stay crisp at their small size.
 */
export function ArrangementGlyph({ rects }: Readonly<{ rects: readonly (readonly [number, number, number, number])[] }>) {
  const W = 22;
  const H = 16;
  const col = (f: number) => Math.round(f * (W - 1)) + 0.5;
  const row = (f: number) => Math.round(f * (H - 1)) + 0.5;
  const lines = new Set<string>();
  for (const [x, y, w, h] of rects) {
    if (x + w < 0.999) lines.add(`M${col(x + w)} ${row(y)}V${row(y + h)}`);
    if (y + h < 0.999) lines.add(`M${col(x)} ${row(y + h)}H${col(x + w)}`);
  }
  return (
    <svg className="mh-glyph" width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
      <rect x="0.5" y="0.5" width={W - 1} height={H - 1} rx="1.5" />
      <path d={[...lines].join("")} />
    </svg>
  );
}
