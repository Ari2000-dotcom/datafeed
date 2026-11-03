import { useEffect, useMemo, useState } from "react"
import { AlertIcon, SearchIcon } from "@/components/icons"
import { Segmented } from "@/components/app/toolbar"

import { IndexCard } from "@/components/app/index-card"
import { Move, TONE_TEXT } from "@/components/app/move"
import { PageHeader } from "@/components/app/page-header"
import { RangeBar } from "@/components/app/range-bar"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { daysTo, expiryLabel, fmt0, fmt2, nearestExpiry, signed, toneOf } from "@/lib/format"
import { EXCHANGE, FEATURED, instrumentName } from "@/lib/instruments"
import { hrefOf, navigate } from "@/lib/router"
import { useDay } from "@/lib/use-day"
import { useReference, useUniverse, type Underlying } from "@/lib/use-hub"
import { useTickFlash } from "@/lib/use-tick-flash"
import { cn } from "@/lib/utils"

type Filter = "all" | "nse" | "bse" | "mcx"

const HEAD = "h-9 px-3 type-label"
const NUM_HEAD = cn(HEAD, "text-right")
const CELL = "h-10 px-3 py-0"

/** Whether a row has waited this long for its first quote: past that, a dash beats a skeleton that never resolves. */
function useWaited(ms: number): boolean {
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), ms)
    return () => clearTimeout(t)
  }, [ms])
  return waited
}

function MarketRow({ u }: { u: Underlying }) {
  const reference = useReference(u)
  const day = useDay(reference, { spark: false })
  const { quote } = day
  const flash = useTickFlash<HTMLSpanElement>(quote?.ltp)
  const waited = useWaited(8_000)
  const market = u.id.split(":")[0]!
  const expiry = nearestExpiry(u.expiries)
  const days = expiry ? daysTo(expiry) : null
  const pending = !quote && !waited

  return (
    <TableRow onClick={() => navigate(hrefOf.charts(u.id))} className="cursor-pointer">
      <TableCell className={CELL}>
        <a href={hrefOf.charts(u.id)} onClick={(e) => e.stopPropagation()} className="font-medium outline-none hover:underline focus-visible:underline">
          {instrumentName(u.id, u.name)}
        </a>
        <span className="ml-2 type-meta">{EXCHANGE[market]}</span>
        {market === "mcx" ? <span className="ml-1 type-meta">futures</span> : null}
      </TableCell>
      <TableCell className={cn(CELL, "text-right")}>
        {quote ? (
          <span ref={flash} className="num rounded-sm px-1 text-foreground">
            {fmt2(quote.ltp)}
          </span>
        ) : pending ? (
          <Skeleton className="ml-auto h-4 w-16" />
        ) : (
          <span className="text-subtle">-</span>
        )}
      </TableCell>
      <TableCell className={cn(CELL, "num text-right", day.change !== null ? TONE_TEXT[toneOf(day.change)] : "text-subtle")}>{day.change !== null ? signed(day.change) : pending ? <Skeleton className="ml-auto h-4 w-14" /> : "-"}</TableCell>
      <TableCell className={cn(CELL, "text-right")}>{day.pct !== null || !pending ? <Move change={day.change} pct={day.pct} /> : <Skeleton className="ml-auto h-4 w-14" />}</TableCell>
      <TableCell className={CELL}>
        <div className="flex items-center gap-2">
          <span className="num w-[9ch] text-right text-xs text-muted-foreground">{day.low !== null ? fmt2(day.low) : ""}</span>
          <RangeBar low={day.low} high={day.high} value={quote?.ltp} className="w-20 shrink-0" />
          <span className="num w-[9ch] text-xs text-muted-foreground">{day.high !== null ? fmt2(day.high) : ""}</span>
        </div>
      </TableCell>
      <TableCell className={cn(CELL, "num text-right text-muted-foreground")}>{day.prevClose !== null ? fmt2(day.prevClose) : "-"}</TableCell>
      <TableCell className={cn(CELL, "num text-right")}>
        {expiry ? (
          <>
            {expiryLabel(expiry)}
            <span className="ml-2 inline-block w-[4ch] text-left text-subtle">{days === 0 ? "today" : `${days}d`}</span>
          </>
        ) : (
          "-"
        )}
      </TableCell>
      <TableCell className={cn(CELL, "num text-right text-muted-foreground")}>{fmt0(u.lot)}</TableCell>
    </TableRow>
  )
}

function SkeletonRows() {
  return Array.from({ length: 9 }, (_, i) => (
    <TableRow key={i} className="hover:bg-transparent">
      <TableCell className={CELL}>
        <Skeleton className="h-4 w-28" />
      </TableCell>
      {Array.from({ length: 7 }, (_, j) => (
        <TableCell key={j} className={CELL}>
          <Skeleton className="ml-auto h-4 w-16" />
        </TableCell>
      ))}
    </TableRow>
  ))
}

export function MarketsPage() {
  const { list, loading, error } = useUniverse()
  const [filter, setFilter] = useState<Filter>("all")
  const [query, setQuery] = useState("")

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return list.filter((u) => (filter === "all" || u.id.startsWith(`${filter}:`)) && (!q || u.name.toLowerCase().includes(q) || instrumentName(u.id, u.name).toLowerCase().includes(q)))
  }, [list, filter, query])

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Markets" note="Change is measured against the previous close." />

      <div className="min-h-0 flex-1 overflow-y-auto bg-background">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-8 px-6 pt-5 pb-8">
          <section aria-labelledby="indices-heading" className="flex flex-col gap-3">
            <h2 id="indices-heading" className="type-heading">
              Indices
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {FEATURED.map((index) => (
                <IndexCard key={index.id} index={index} />
              ))}
            </div>
          </section>

          <section aria-labelledby="instruments-heading" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <h2 id="instruments-heading" className="type-heading">
                Instruments with options
              </h2>
              <span className="num type-meta">{loading ? "" : `${rows.length} of ${list.length}`}</span>
              <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                <Segmented value={filter} onChange={setFilter} label="Exchange" items={[{ value: "all", label: "All" }, { value: "nse", label: "NSE" }, { value: "bse", label: "BSE" }, { value: "mcx", label: "MCX" }]} />
                <InputGroup className="w-full sm:w-48">
                  <InputGroupAddon>
                    <SearchIcon />
                  </InputGroupAddon>
                  <InputGroupInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter" aria-label="Filter instruments" />
                </InputGroup>
              </div>
            </div>

            {error ? (
              <Empty className="rounded-lg border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <AlertIcon />
                  </EmptyMedia>
                  <EmptyTitle>Could not load instruments</EmptyTitle>
                  <EmptyDescription>{error}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : !loading && rows.length === 0 ? (
              <Empty className="rounded-lg border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <SearchIcon />
                  </EmptyMedia>
                  <EmptyTitle>No instrument matches</EmptyTitle>
                  <EmptyDescription>Clear the filter or pick another exchange.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="overflow-hidden rounded-lg border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className={HEAD}>Instrument</TableHead>
                      <TableHead className={NUM_HEAD}>Last</TableHead>
                      <TableHead className={NUM_HEAD}>Change</TableHead>
                      <TableHead className={NUM_HEAD}>Change %</TableHead>
                      <TableHead className={HEAD}>Day range</TableHead>
                      <TableHead className={NUM_HEAD}>Prev close</TableHead>
                      <TableHead className={NUM_HEAD}>Next expiry</TableHead>
                      <TableHead className={NUM_HEAD}>Lot</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>{loading ? <SkeletonRows /> : rows.map((u) => <MarketRow key={u.id} u={u} />)}</TableBody>
                </Table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
