# What three customer-facing products do that AlphaHedge does not

Captured 2026-11-02 at 1440×900 with Playwright, computed styles sampled off the live pages.
Raw numbers in `linear-tokens.json` and `groww-tokens.json`; screenshots beside them.

| | linear.app | robinhood.com | groww.in |
|---|---|---|---|
| Ground | `#08090A` blue-tinted near-black | `#000000` + `#110E08` warm near-black | `#FFFFFF` + `#060809` dark band |
| Accent | `#4EA7FC`, used on almost nothing | `#CCFF00` acid lime, **33.7% of painted area** | `#04B488` green |
| Faces | Inter Variable + **Berkeley Mono** (185 uses) + Tiempos Headline | Phonic (sans) + **Martina Plantijn** (serif, 2 uses) | GrowwSans + **Soehne** (display) |
| Weights | 300 / 400 / **510** / **590** / 680 | 400 / 700 | **435** / **535** |
| Display | h1 64px/64px, `−1.408px` | h1 110px/110px serif, weight 400 | h1 88px/96.8px, weight 535 |
| Body | 15px/24px, `#8A8F98` | 16px, `−0.25px` | 14px/20px |
| Radii | 4/6/8/12/16/24/32/9999/50% | **36px, nothing else** | 6/8/12/22/24/99/50% |
| Shadows | hairlines + insets only | **none** | **none** |
| Focus ring | yes | no | yes |
| Reduced motion | yes | no | no |

AlphaHedge today: `#222222` / `#151515` neutral grey, one face, weights 400 and 600,
`letter-spacing: normal` everywhere, `--mh-plate-edge: transparent`, no shadows, no max-width.

## The nine things worth taking

### 1. The ground is tinted, never neutral grey
Linear `#08090A` is blue-tinted; Robinhood `#110E08` is warm. Neither is a grey. A 1–2%
hue in the near-black is most of what separates "premium dark" from "default dark".
AlphaHedge's `#222222` and `#151515` are hue-free, which is what makes them read flat.

### 2. The emphasis weight is ~510, not 600
Linear names it `--font-weight-medium: 510`; Groww uses 535. Nobody steps from 400 to
600 — that jump is the single loudest "built by hand" tell. AlphaHedge's
`--mh-weight-strong: 600` wants to be 510.

### 3. Tracking is negative and scales with size
Not one value: Linear runs `−0.13px` at 13px, `−0.165px` at 15px, `−1.408px` at 64px —
about `−0.011em` for text and `−0.022em` for display. Robinhood: `−0.25px` at 16px,
`−1.5px` at 52px. AlphaHedge sets `normal` at every size.

### 4. Depth is a hairline plus an inset, never a drop shadow
Robinhood and Groww ship **zero** `box-shadow`. Linear's five shadows are all structural:

```
rgba(255,255,255,0.08) 0 0 0 0.5px inset   /* the top-edge highlight */
rgba(0,0,0,0.20)       0 0 0 1px           /* the ring that separates */
rgba(0,0,0,0.20)       0 0 12px 0 inset    /* the well */
```

Plus a `1px rgba(255,255,255,0.08)` border on 66 elements. AlphaHedge's plates have
`--mh-plate-edge: transparent` — no edge at all. A white-at-8% hairline on a deep plate
is the entire difference.

### 5. Surfaces are white-alpha over the ground, not separate greys
Linear: `rgba(255,255,255,0.02)` raised, `0.08` hairline, `0.12` hover. AlphaHedge stacks
opaque `#1b1b1b` / `#262626` / `#323232`. Alpha composes over any ground and never bands.

### 6. One accent, and either loud or nearly invisible
Robinhood commits: acid lime over a third of the painted area. Linear abstains: its blue
appears on 4 elements. Both are decisions. AlphaHedge's blue is in the middle — present
everywhere, loud nowhere.

### 7. A monospace carries the identifiers
Linear uses Berkeley Mono 185 times, for IDs and codes. In a straddle desk the *figures*
are the identifiers. A real tabular mono for numbers against the sans for words is the
largest single upgrade available here — and the one that most needs the user's say-so,
since it reintroduces a second face.

### 8. Named scales, not arbitrary numbers
Linear exposes `--radius-4…32`, `--layer-1…11000` (`--layer-tooltip: 1100`,
`--layer-dialog: 700`), `--speed-quickTransition: .1s`, `--speed-regularTransition: .25s`,
`--border-hairline: 1px`. AlphaHedge has radius and duration tokens but no z-index scale.

### 9. A customer page has a measure; a terminal does not
Linear: `--page-max-width: 1024px`, `--prose-max-width: 624px`,
`--homepage-max-width: 1344px + 46px` gutters, `--page-padding-block: 64px`, 12 columns.
Groww: a 1400px container. The product screenshot sits *inside* a 12px-radius hairline
frame with real air around it, never bleeding to the edge. AlphaHedge fills the viewport
with 3px gutters — correct for the Terminal, wrong for a customer landing on the Desk.

## What not to copy

Robinhood ships no `:focus-visible` and no `prefers-reduced-motion`. Groww ships no
reduced-motion rule. AlphaHedge already handles both; keep that.

## A token set this suggests for the customer desk

```css
:root {
  /* tinted, not grey */
  --ground:       #0A0B0D;   /* was #222222 */
  --plate:        #121316;   /* was #151515 */
  --raised:       rgba(255, 255, 255, 0.02);
  --hairline:     rgba(255, 255, 255, 0.08);
  --hairline-up:  rgba(255, 255, 255, 0.12);   /* hover */
  --well:         inset 0 0 12px rgba(0, 0, 0, 0.2);
  --edge-light:   inset 0 0 0 0.5px rgba(255, 255, 255, 0.08);

  /* 510, not 600 */
  --weight-normal:   400;
  --weight-medium:   510;
  --weight-semibold: 590;

  /* tracking by size, about -0.011em text / -0.022em display */
  --track-13: -0.14px;
  --track-15: -0.17px;
  --track-19: -0.21px;
  --track-48: -1.06px;

  --radius-4: 4px; --radius-8: 8px; --radius-12: 12px; --radius-pill: 9999px;
  --speed-quick: 0.1s;
  --speed-regular: 0.25s;
  --ease: cubic-bezier(0.25, 0.46, 0.45, 0.94);

  --page-max: 1344px;
  --page-pad-inline: 24px;
  --page-pad-block: 64px;
}
```
