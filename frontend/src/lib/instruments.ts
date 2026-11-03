/** The indices the screens feature, by the hub's canonical id. */
export interface FeaturedIndex {
  id: string
  /** The short name a strip or card shows: proper case, short enough that a number never clips. */
  label: string
  /** Full name, for a card or a tooltip. */
  name: string
  exchange: "NSE" | "BSE"
  /** Has options to open. India VIX is a reading, not a market with strikes. */
  options: boolean
  /** Sits in the strip under the nav bar. */
  strip: boolean
}

export const FEATURED: readonly FeaturedIndex[] = [
  { id: "nse:nifty", label: "Nifty 50", name: "Nifty 50", exchange: "NSE", options: true, strip: true },
  { id: "nse:banknifty", label: "Nifty Bank", name: "Nifty Bank", exchange: "NSE", options: true, strip: true },
  { id: "bse:sensex", label: "Sensex", name: "BSE Sensex", exchange: "BSE", options: true, strip: true },
  { id: "nse:finnifty", label: "Fin Nifty", name: "Nifty Financial Services", exchange: "NSE", options: true, strip: true },
  { id: "nse:midcpnifty", label: "Midcap Select", name: "Nifty Midcap Select", exchange: "NSE", options: true, strip: true },
  { id: "nse:niftynxt50", label: "Nifty Next 50", name: "Nifty Next 50", exchange: "NSE", options: true, strip: false },
  { id: "bse:bankex", label: "Bankex", name: "BSE Bankex", exchange: "BSE", options: true, strip: false },
  { id: "nse:indiavix", label: "India VIX", name: "India VIX", exchange: "NSE", options: false, strip: true },
]

export const EXCHANGE: Record<string, string> = { nse: "NSE", bse: "BSE", mcx: "MCX" }

/**
 * Names in one case rule: proper nouns capitalised ("Nifty Bank", "Crude oil"), acronyms upper
 * ("VIX"). The hub's own symbols (BANKNIFTY, CRUDEOIL) are for typing, not for reading.
 */
const NAMES: Record<string, string> = {
  "nse:nifty": "Nifty 50",
  "nse:banknifty": "Nifty Bank",
  "bse:sensex": "Sensex",
  "nse:finnifty": "Nifty Fin Service",
  "nse:midcpnifty": "Nifty Midcap Select",
  "nse:niftynxt50": "Nifty Next 50",
  "bse:bankex": "Bankex",
  "nse:indiavix": "India VIX",
  "mcx:crudeoil": "Crude oil",
  "mcx:crudeoilm": "Crude oil mini",
  "mcx:naturalgas": "Natural gas",
  "mcx:natgasmini": "Natural gas mini",
  "mcx:copper": "Copper",
  "mcx:zinc": "Zinc",
  "mcx:gold": "Gold",
  "mcx:goldm": "Gold mini",
  "mcx:silver": "Silver",
  "mcx:silverm": "Silver mini",
}

/** The reading name of an instrument; an unknown one is its symbol with a capital. */
export function instrumentName(id: string, symbol?: string): string {
  const known = NAMES[id]
  if (known) return known
  const raw = symbol ?? id.split(":")[1] ?? id
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
}
