import { useState, useEffect, useRef } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { auth } from "../firebase"
import ReactECharts from "echarts-for-react"

async function getToken() {
  try {
    return await auth.currentUser?.getIdToken()
  } catch {
    return null
  }
}

function fmtMarketCap(n) {
  if (n == null) return "—"
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  return `$${n.toLocaleString()}`
}

function fmtNum(n, decimals = 2) {
  if (n == null) return "—"
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function fmtVol(n) {
  if (n == null) return "—"
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return String(n)
}

function timeAgo(isoString) {
  if (!isoString) return ""
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000)
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

const RANGE_DAYS = { "1W": 7, "1M": 30, "3M": 90, "1Y": 365 }

function sliceHistory(dates, prices, range) {
  if (!dates.length) return { dates: [], prices: [] }
  if (range === "1Y") return { dates, prices }
  const cutoff = new Date(Date.now() - RANGE_DAYS[range] * 86400000).toISOString().slice(0, 10)
  const idx = dates.findIndex(d => d >= cutoff)
  if (idx === -1) return { dates: dates.slice(-1), prices: prices.slice(-1) }
  return { dates: dates.slice(idx), prices: prices.slice(idx) }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CompanyAboutCard({ data }) {
  const [expanded, setExpanded] = useState(false)
  const desc = data.description
  const LIMIT = 280
  const preview = desc && desc.length > LIMIT ? desc.slice(0, LIMIT) + "…" : desc

  return (
    <div className="bg-white/[0.02] border border-white/8 rounded-2xl p-5 flex flex-col gap-3">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">About</h3>
      {desc ? (
        <>
          <p className="text-sm text-gray-400 leading-relaxed">{expanded ? desc : preview}</p>
          {desc.length > LIMIT && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-xs text-indigo-400 hover:text-indigo-300 transition self-start"
            >
              {expanded ? "Show less" : "Read more"}
            </button>
          )}
        </>
      ) : (
        <p className="text-sm text-gray-600">No description available.</p>
      )}
    </div>
  )
}

function TickerSearchBar({ onSelect }) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const timerRef = useRef(null)
  const containerRef = useRef(null)

  useEffect(() => {
    if (!query.trim()) { setResults([]); setOpen(false); return }
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tickers/search?q=${encodeURIComponent(query)}`)
        const data = await res.json()
        setResults(data.results || [])
        setOpen(true)
      } catch { setResults([]) }
    }, 200)
    return () => clearTimeout(timerRef.current)
  }, [query])

  useEffect(() => {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  const handleSelect = (symbol) => {
    setQuery(symbol)
    setOpen(false)
    onSelect(symbol)
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="flex items-center gap-3 px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus-within:ring-2 focus-within:ring-indigo-500/50 focus-within:border-indigo-500/50 transition">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
          className="w-4 h-4 text-gray-500 shrink-0">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search ticker or company…"
          className="flex-1 bg-transparent text-sm text-white placeholder-gray-600 focus:outline-none"
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-[#13131a] border border-white/10 rounded-xl shadow-xl overflow-hidden">
          {results.map(r => (
            <button
              key={r.symbol}
              onMouseDown={() => handleSelect(r.symbol)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.06] transition text-left"
            >
              <span className="text-sm font-semibold text-white">{r.symbol}</span>
              <span className="text-xs text-gray-500 truncate">{r.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function KeyStatsCard({ data }) {
  const rows = [
    { label: "Market Cap", value: fmtMarketCap(data.market_cap) },
    { label: "P/E (TTM)", value: data.pe_ratio != null ? fmtNum(data.pe_ratio) : "—" },
    { label: "Fwd P/E", value: data.forward_pe != null ? fmtNum(data.forward_pe) : "—" },
    { label: "52W High", value: data.fifty_two_week_high != null ? `$${fmtNum(data.fifty_two_week_high)}` : "—" },
    { label: "52W Low", value: data.fifty_two_week_low != null ? `$${fmtNum(data.fifty_two_week_low)}` : "—" },
    { label: "Volume", value: fmtVol(data.volume) },
    { label: "Avg Vol", value: fmtVol(data.avg_volume) },
    { label: "Industry", value: data.industry || "—" },
  ]

  const hi = data.fifty_two_week_high
  const lo = data.fifty_two_week_low
  const cur = data.current_price
  const rangePos = (hi && lo && hi !== lo) ? Math.max(0, Math.min(100, ((cur - lo) / (hi - lo)) * 100)) : null

  return (
    <div className="bg-white/[0.02] border border-white/8 rounded-2xl p-5 flex flex-col gap-3">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Key Stats</h3>
      <div className="flex flex-col divide-y divide-white/[0.04]">
        {rows.map(r => (
          <div key={r.label} className="flex items-center justify-between py-2">
            <span className="text-xs text-gray-500">{r.label}</span>
            <span className="text-xs text-gray-200 font-medium text-right">{r.value}</span>
          </div>
        ))}
      </div>
      {rangePos !== null && (
        <div className="pt-1">
          <div className="flex justify-between text-[10px] text-gray-600 mb-1.5">
            <span>${fmtNum(lo)}</span>
            <span className="text-gray-500">52W Range</span>
            <span>${fmtNum(hi)}</span>
          </div>
          <div className="relative h-1 bg-white/10 rounded-full">
            <div
              className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-indigo-400 border-2 border-[#0a0a0f]"
              style={{ left: `calc(${rangePos}% - 5px)` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function PriceChartSkeleton() {
  return (
    <div className="flex-1 min-h-[180px] relative overflow-hidden rounded-xl">
      {/* Ghost chart line */}
      <svg className="w-full h-full" viewBox="0 0 400 180" preserveAspectRatio="none">
        <defs>
          <linearGradient id="skelFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(99,102,241,0.12)" />
            <stop offset="100%" stopColor="rgba(99,102,241,0)" />
          </linearGradient>
          <linearGradient id="skelShimmer" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(255,255,255,0)" />
            <stop offset="50%" stopColor="rgba(255,255,255,0.06)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
            <animateTransform attributeName="gradientTransform" type="translate" from="-1 0" to="2 0" dur="1.6s" repeatCount="indefinite" />
          </linearGradient>
        </defs>
        {/* Filled area */}
        <path
          d="M0 140 C 60 125, 100 95, 150 100 S 220 70, 270 75 S 340 45, 400 52 L 400 180 L 0 180 Z"
          fill="url(#skelFill)"
        />
        {/* Chart line */}
        <path
          d="M0 140 C 60 125, 100 95, 150 100 S 220 70, 270 75 S 340 45, 400 52"
          fill="none"
          stroke="rgba(99,102,241,0.25)"
          strokeWidth="1.5"
        />
        {/* Shimmer overlay */}
        <rect x="0" y="0" width="400" height="180" fill="url(#skelShimmer)" />
      </svg>
      {/* Y-axis skeleton bars */}
      <div className="absolute left-0 top-0 h-full flex flex-col justify-between py-2 pl-1 gap-0">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-2 w-8 bg-white/[0.04] rounded animate-pulse" />
        ))}
      </div>
    </div>
  )
}

function PriceChartCard({ dates, prices, loading }) {
  const [range, setRange] = useState("1Y")
  const { dates: d, prices: p } = sliceHistory(dates, prices, range)
  const isUp = p.length >= 2 && p[p.length - 1] >= p[0]
  const color = isUp ? "#34d399" : "#fb7185"

  const option = {
    backgroundColor: "transparent",
    grid: { top: 8, right: 8, bottom: 28, left: 48 },
    xAxis: {
      type: "category",
      data: d,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: "#6b7280",
        fontSize: 10,
        showMaxLabel: true,
        showMinLabel: true,
        formatter: v => v.slice(5),
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      scale: true,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: "#6b7280", fontSize: 10, formatter: v => `$${v}` },
      splitLine: { lineStyle: { color: "rgba(255,255,255,0.04)" } },
    },
    series: [{
      type: "line",
      data: p,
      smooth: false,
      symbol: "none",
      lineStyle: { color, width: 1.5 },
      areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: color + "33" }, { offset: 1, color: color + "00" }] } },
    }],
    tooltip: {
      trigger: "axis",
      backgroundColor: "#1a1a27",
      borderColor: "rgba(255,255,255,0.08)",
      textStyle: { color: "#e5e7eb", fontSize: 12 },
      formatter: params => {
        const pt = params[0]
        return `<div style="font-size:10px;color:#9ca3af">${pt.name}</div><div style="font-weight:600">$${Number(pt.value).toFixed(2)}</div>`
      },
    },
  }

  return (
    <div className="bg-white/[0.02] border border-white/8 rounded-2xl p-5 flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Price Chart</h3>
        <div className="flex gap-1">
          {Object.keys(RANGE_DAYS).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              disabled={loading}
              className={`px-2 py-0.5 text-xs rounded-lg transition ${range === r ? "bg-indigo-600 text-white" : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.05]"} disabled:opacity-40`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      {loading
        ? <PriceChartSkeleton />
        : d.length > 1
          ? <ReactECharts option={option} style={{ height: "100%", minHeight: 180 }} opts={{ renderer: "svg" }} className="flex-1" />
          : <div className="flex-1 flex items-center justify-center text-sm text-gray-600">No chart data</div>
      }
    </div>
  )
}

function ExpiryDropdown({ expiries, value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener("mousedown", handle)
    return () => document.removeEventListener("mousedown", handle)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-xs bg-white/[0.05] border border-white/10 rounded-lg px-2.5 py-1.5 text-gray-300 hover:bg-white/[0.08] hover:border-white/20 transition"
      >
        <span>{value || "—"}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-3 h-3 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-36 max-h-64 overflow-y-auto bg-[#13131a] border border-white/10 rounded-xl shadow-xl">
          {expiries.map(e => (
            <button
              key={e}
              onMouseDown={() => { onChange(e); setOpen(false) }}
              className={`w-full text-left px-3 py-2 text-xs transition ${e === value ? "text-indigo-400 bg-indigo-500/10" : "text-gray-300 hover:bg-white/[0.06]"}`}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function OptionsChainPanel({ expiries, ticker, currentPrice, onAnalyse }) {
  const fmtIv = v => v != null ? `${(v * 100).toFixed(1)}%` : "—"
  const fmtGreek = v => v != null ? v.toFixed(3) : "—"
  const fmtPrice = v => v != null ? `$${fmtNum(v)}` : "—"

  // Default: nearest expiry >= 28 days out
  const defaultExpiry = (() => {
    const cutoff = new Date(Date.now() + 28 * 86400000).toISOString().slice(0, 10)
    return expiries.find(e => e >= cutoff) || expiries[0] || null
  })()

  const [selectedExpiry, setSelectedExpiry] = useState(defaultExpiry)
  const [chain, setChain] = useState(null) // null=loading, false=error, object=data
  const [side, setSide] = useState("calls") // "calls" | "puts"

  useEffect(() => {
    if (!selectedExpiry || !ticker) return
    setChain(null)
    fetch(`/api/stock/${ticker}/chain?expiry=${selectedExpiry}`)
      .then(r => r.json())
      .then(d => setChain(d))
      .catch(() => setChain(false))
  }, [selectedExpiry, ticker])

  if (expiries.length === 0) {
    return (
      <div className="bg-white/[0.02] border border-white/8 rounded-2xl p-5">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Options Chain</h3>
        <p className="text-sm text-gray-600">No options available for this stock.</p>
      </div>
    )
  }

  const rows = chain && chain !== false ? (chain[side] || []) : []
  const price = (chain && chain.current_price) || currentPrice

  return (
    <div className="bg-white/[0.02] border border-white/8 rounded-2xl overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-white/[0.04] flex flex-wrap items-center gap-3 justify-between">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Options Chain</h3>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Calls / Puts toggle */}
          <div className="flex items-center bg-white/[0.03] border border-white/10 rounded-lg p-0.5">
            {["calls", "puts"].map(s => (
              <button
                key={s}
                onClick={() => setSide(s)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition ${side === s ? (s === "calls" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-rose-500/20 text-rose-400 border border-rose-500/30") : "text-gray-500 hover:text-gray-300"}`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          {/* Custom expiry dropdown */}
          <ExpiryDropdown expiries={expiries} value={selectedExpiry} onChange={setSelectedExpiry} />
          <button
            onClick={onAnalyse}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition shadow-lg shadow-indigo-500/20"
          >
            Analyse →
          </button>
        </div>
      </div>

      {/* Table */}
      {chain === null ? (
        <div className="flex flex-col gap-2 p-5">
          {[1,2,3,4,5,6,7,8].map(i => (
            <div key={i} className="h-7 bg-white/[0.04] rounded animate-pulse" />
          ))}
        </div>
      ) : chain === false ? (
        <p className="text-sm text-gray-600 p-5">Could not load chain data.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-600 p-5">No contracts available for this expiry.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-600 border-b border-white/[0.04]">
                <th className="text-right px-4 py-2 font-medium">Strike</th>
                <th className="text-right px-3 py-2 font-medium">Bid</th>
                <th className="text-right px-3 py-2 font-medium">Ask</th>
                <th className="text-right px-3 py-2 font-medium">Mid / Last</th>
                <th className="text-right px-3 py-2 font-medium">IV</th>
                <th className="text-right px-3 py-2 font-medium">Delta</th>
                <th className="text-right px-3 py-2 font-medium">Gamma</th>
                <th className="text-right px-3 py-2 font-medium">Theta</th>
                <th className="text-right px-3 py-2 font-medium">Vega</th>
                <th className="text-right px-3 py-2 font-medium">Vol</th>
                <th className="text-right px-4 py-2 font-medium">OI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.03]">
              {rows.map((r, i) => {
                const isAtm = price && r.strike != null && Math.abs(r.strike - price) === Math.min(...rows.map(x => Math.abs(x.strike - price)))
                return (
                  <tr key={i} className={`transition ${isAtm ? "bg-indigo-500/[0.07]" : "hover:bg-white/[0.02]"}`}>
                    <td className={`px-4 py-2 text-right font-semibold ${r.in_the_money ? (side === "calls" ? "text-emerald-400" : "text-rose-400") : "text-gray-400"}`}>
                      ${fmtNum(r.strike)}
                      {isAtm && <span className="ml-1.5 text-[9px] text-indigo-400 font-medium">ATM</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-400">{fmtPrice(r.bid)}</td>
                    <td className="px-3 py-2 text-right text-gray-400">{fmtPrice(r.ask)}</td>
                    <td className="px-3 py-2 text-right font-medium">
                      {r.mid != null ? <span className="text-gray-200">{fmtPrice(r.mid)}</span> : r.last != null ? <span className="text-gray-500">{fmtPrice(r.last)}</span> : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-amber-400">{fmtIv(r.iv)}</td>
                    <td className="px-3 py-2 text-right text-gray-300">{fmtGreek(r.delta)}</td>
                    <td className="px-3 py-2 text-right text-gray-400">{fmtGreek(r.gamma)}</td>
                    <td className="px-3 py-2 text-right text-rose-400">{fmtGreek(r.theta)}</td>
                    <td className="px-3 py-2 text-right text-sky-400">{fmtGreek(r.vega)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{r.volume != null ? r.volume.toLocaleString() : "—"}</td>
                    <td className="px-4 py-2 text-right text-gray-500">{r.open_interest != null ? r.open_interest.toLocaleString() : "—"}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function NewsCard({ news, error }) {
  return (
    <div className="bg-white/[0.02] border border-white/8 rounded-2xl p-5 flex flex-col gap-4">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">News</h3>
      {news === null ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="h-3 bg-white/[0.06] rounded animate-pulse w-full" />
              <div className="h-3 bg-white/[0.06] rounded animate-pulse w-3/4" />
              <div className="h-2.5 bg-white/[0.04] rounded animate-pulse w-1/4 mt-0.5" />
            </div>
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-gray-600">Could not load news.</p>
      ) : news.length === 0 ? (
        <p className="text-sm text-gray-600">No recent news available.</p>
      ) : (
        <div className="flex flex-col divide-y divide-white/[0.04]">
          {news.map((item, i) => (
            <a
              key={i}
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="py-3 first:pt-0 last:pb-0 group flex flex-col gap-1 hover:opacity-80 transition"
            >
              <p className="text-sm text-gray-300 group-hover:text-white transition line-clamp-2 leading-snug">{item.title}</p>
              <p className="text-[10px] text-gray-600">
                {item.publisher}
                {item.published_at && <> · {timeAgo(item.published_at)}</>}
              </p>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

function LsBadge({ value }) {
  const isLong = (value || "").toLowerCase() === "long"
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${isLong ? "bg-sky-500/15 text-sky-400 border border-sky-500/20" : "bg-amber-500/15 text-amber-400 border border-amber-500/20"}`}>
      {isLong ? "L" : "S"}
    </span>
  )
}

function CpBadge({ value }) {
  const isCall = (value || "").toLowerCase() === "call"
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${isCall ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/15 text-rose-400 border border-rose-500/20"}`}>
      {isCall ? "C" : "P"}
    </span>
  )
}

function StockHoldingsTable({ positions }) {
  const totalPnl = positions.reduce((s, p) => s + (p.pnl_sgd ?? 0), 0)
  const totalMv = positions.reduce((s, p) => s + (p.market_value_sgd ?? 0), 0)
  return (
    <div className="bg-white/[0.02] border border-white/8 rounded-2xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-white/[0.04] flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Your Holdings — Stocks &amp; CFDs</h3>
        <div className="flex items-center gap-4 text-xs">
          <span className="text-gray-500">Mkt Val: <span className="text-gray-300 font-medium">S${fmtNum(totalMv, 0)}</span></span>
          <span className="text-gray-500">P&amp;L: <span className={`font-medium ${totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{totalPnl >= 0 ? "+" : ""}S${fmtNum(totalPnl, 0)}</span></span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-600 border-b border-white/[0.04]">
              <th className="text-left px-5 py-2 font-medium">Instrument</th>
              <th className="text-center px-3 py-2 font-medium">L/S</th>
              <th className="text-right px-3 py-2 font-medium">Qty</th>
              <th className="text-right px-3 py-2 font-medium">Open</th>
              <th className="text-right px-3 py-2 font-medium">Current</th>
              <th className="text-right px-5 py-2 font-medium">Mkt Val (SGD)</th>
              <th className="text-right px-5 py-2 font-medium">P&amp;L (SGD)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.03]">
            {positions.map((p, i) => (
              <tr key={i} className="hover:bg-white/[0.02] transition">
                <td className="px-5 py-2.5 text-gray-300 max-w-[200px] truncate">{p.instrument}</td>
                <td className="px-3 py-2.5 text-center"><LsBadge value={p.l_s} /></td>
                <td className="px-3 py-2.5 text-right text-gray-300">{p.quantity ?? "—"}</td>
                <td className="px-3 py-2.5 text-right text-gray-400">{p.open_price != null ? `$${fmtNum(p.open_price)}` : "—"}</td>
                <td className="px-3 py-2.5 text-right text-gray-300">{p.current_price != null ? `$${fmtNum(p.current_price)}` : "—"}</td>
                <td className="px-5 py-2.5 text-right text-gray-300">{p.market_value_sgd != null ? `S$${fmtNum(p.market_value_sgd, 0)}` : "—"}</td>
                <td className={`px-5 py-2.5 text-right font-medium ${(p.pnl_sgd ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {p.pnl_sgd != null ? `${p.pnl_sgd >= 0 ? "+" : ""}S$${fmtNum(p.pnl_sgd, 0)}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function OptionsHoldingsTable({ positions }) {
  const totalPnl = positions.reduce((s, p) => s + (p.pnl_sgd ?? 0), 0)
  const totalMv = positions.reduce((s, p) => s + (p.market_value_sgd ?? 0), 0)
  return (
    <div className="bg-white/[0.02] border border-white/8 rounded-2xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-white/[0.04] flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Your Holdings — Options</h3>
        <div className="flex items-center gap-4 text-xs">
          <span className="text-gray-500">Mkt Val: <span className="text-gray-300 font-medium">S${fmtNum(totalMv, 0)}</span></span>
          <span className="text-gray-500">P&amp;L: <span className={`font-medium ${totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{totalPnl >= 0 ? "+" : ""}S${fmtNum(totalPnl, 0)}</span></span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-600 border-b border-white/[0.04]">
              <th className="text-left px-5 py-2 font-medium">Instrument</th>
              <th className="text-center px-3 py-2 font-medium">C/P</th>
              <th className="text-right px-3 py-2 font-medium">Strike</th>
              <th className="text-right px-3 py-2 font-medium">Expiry</th>
              <th className="text-center px-3 py-2 font-medium">L/S</th>
              <th className="text-right px-3 py-2 font-medium">Qty</th>
              <th className="text-right px-3 py-2 font-medium">Open</th>
              <th className="text-right px-5 py-2 font-medium">Mkt Val (SGD)</th>
              <th className="text-right px-5 py-2 font-medium">P&amp;L (SGD)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.03]">
            {positions.map((p, i) => (
              <tr key={i} className="hover:bg-white/[0.02] transition">
                <td className="px-5 py-2.5 text-gray-300 max-w-[180px] truncate" title={p.instrument}>{p.instrument}</td>
                <td className="px-3 py-2.5 text-center"><CpBadge value={p.call_put} /></td>
                <td className="px-3 py-2.5 text-right text-gray-300">{p.strike != null ? `$${fmtNum(p.strike)}` : "—"}</td>
                <td className="px-3 py-2.5 text-right text-gray-400 whitespace-nowrap">{p.expiry || "—"}</td>
                <td className="px-3 py-2.5 text-center"><LsBadge value={p.l_s} /></td>
                <td className="px-3 py-2.5 text-right text-gray-300">{p.quantity ?? "—"}</td>
                <td className="px-3 py-2.5 text-right text-gray-400">{p.open_price != null ? `$${fmtNum(p.open_price)}` : "—"}</td>
                <td className="px-5 py-2.5 text-right text-gray-300">{p.market_value_sgd != null ? `S$${fmtNum(p.market_value_sgd, 0)}` : "—"}</td>
                <td className={`px-5 py-2.5 text-right font-medium ${(p.pnl_sgd ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {p.pnl_sgd != null ? `${p.pnl_sgd >= 0 ? "+" : ""}S$${fmtNum(p.pnl_sgd, 0)}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Stock Plan Panel ──────────────────────────────────────────────────────────

function StockPlanPanel({ plan }) {
  return (
    <div className="bg-white/[0.02] border border-indigo-500/20 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">
          Forecast Plan: {plan.name}
        </h3>
        <a
          href={`/app/plans/${plan.ticker}?planId=${plan.id}`}
          className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          Edit →
        </a>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {["bear", "base", "bull"].map(s => {
          const ip = plan.implied?.[s]
          const up = plan.upside?.[s]
          return (
            <div key={s}>
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">{s}</div>
              <div className="text-xl font-bold text-white">
                {ip != null ? `$${ip.toFixed(2)}` : "—"}
              </div>
              <div className={`text-xs font-medium mt-0.5 ${up == null ? "text-gray-500" : up >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {up != null ? `${up >= 0 ? "+" : ""}${(up * 100).toFixed(1)}% upside` : "—"}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function StockPage() {
  const { ticker } = useParams()
  const navigate = useNavigate()
  const [stockData, setStockData] = useState(null)
  const [portfolioPositions, setPortfolioPositions] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [news, setNews] = useState(null) // null = loading, [] = loaded empty
  const [newsError, setNewsError] = useState(false)
  const [stockPlan, setStockPlan] = useState(null)
  const [historyDates, setHistoryDates] = useState([])
  const [historyPrices, setHistoryPrices] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)

  // Fetch portfolio once to check for matching position
  useEffect(() => {
    async function loadPortfolio() {
      try {
        const token = await getToken()
        const res = await fetch("/api/portfolio", { headers: token ? { Authorization: `Bearer ${token}` } : {} })
        if (!res.ok) return
        const data = await res.json()
        window.__arkenVaultPortfolioPositions = data.positions || []
      } catch { /* silent */ }
    }
    loadPortfolio()
  }, [])

  // Fetch stock data when ticker changes
  useEffect(() => {
    if (!ticker) { setStockData(null); setError(""); setNews(null); setNewsError(false); return }
    setLoading(true)
    setError("")
    setStockData(null)
    setPortfolioPositions([])
    setNews(null)
    setNewsError(false)
    setStockPlan(null)
    setHistoryDates([])
    setHistoryPrices([])
    setHistoryLoading(true)

    const clean = ticker.toUpperCase()

    fetch(`/api/stock/${clean}`)
      .then(async res => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.detail || "Failed to load stock data")
        setStockData(data)
        const positions = window.__arkenVaultPortfolioPositions || []
        setPortfolioPositions(positions.filter(p => p.yf_ticker === clean))
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))

    fetch(`/api/stock/${clean}/history`)
      .then(r => r.json())
      .then(d => { setHistoryDates(d.dates || []); setHistoryPrices(d.prices || []) })
      .catch(() => {})
      .finally(() => setHistoryLoading(false))

    getToken().then(token => {
      fetch("/api/plans", { headers: token ? { Authorization: `Bearer ${token}` } : {} })
        .then(r => r.json())
        .then(d => {
          const match = (d.plans || [])
            .filter(p => p.ticker === clean)
            .sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1))[0] || null
          setStockPlan(match)
        })
        .catch(() => {})
    })

    fetch(`/api/stock/${clean}/news`)
      .then(async res => {
        const data = await res.json()
        setNews(data.news || [])
      })
      .catch(() => { setNews([]); setNewsError(true) })
  }, [ticker])

  const handleSelect = (symbol) => navigate(`/app/stock/${symbol}`)

  const handleAnalyse = () => {
    navigate("/app/options", { state: { prefillTicker: ticker?.toUpperCase() } })
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto w-full">
      {/* Search bar */}
      <div className="w-full max-w-md mx-auto">
        <TickerSearchBar onSelect={handleSelect} />
      </div>

      {/* No ticker state */}
      {!ticker && !loading && !error && (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10 text-gray-700">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <p className="text-gray-500 text-sm">Search for a stock to get started.</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex flex-col gap-4">
          <div className="h-16 bg-white/[0.02] border border-white/8 rounded-2xl animate-pulse" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1,2,3,4].map(i => (
              <div key={i} className="h-52 bg-white/[0.02] border border-white/8 rounded-2xl animate-pulse" />
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <p className="text-rose-400 text-sm">{error}</p>
          <button
            onClick={() => navigate(`/app/stock/${ticker}`)}
            className="text-xs text-gray-500 hover:text-gray-300 transition underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      )}

      {/* Stock data */}
      {stockData && !loading && (
        <>
          {/* Header */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-2xl font-bold text-white">{stockData.name}</h1>
              <span className="text-xs font-semibold text-indigo-200 bg-indigo-500/30 border border-indigo-400/40 px-2.5 py-1 rounded-lg">{stockData.ticker}</span>
              {stockData.sector && (
                <span className="text-xs font-medium text-emerald-200 bg-emerald-500/20 border border-emerald-400/35 px-2.5 py-1 rounded-lg">{stockData.sector}</span>
              )}
              {stockData.country && (
                <span className="text-xs font-medium text-amber-200 bg-amber-500/15 border border-amber-400/30 px-2.5 py-1 rounded-lg">{stockData.country}</span>
              )}
            </div>
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-3xl font-bold text-white">${fmtNum(stockData.current_price)}</span>
              {stockData.change != null && (
                <span className={`text-sm font-semibold ${stockData.change >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {stockData.change >= 0 ? "+" : ""}{fmtNum(stockData.change)} ({stockData.change >= 0 ? "+" : ""}{fmtNum(stockData.change_pct)}%)
                </span>
              )}
            </div>
          </div>

          {/* Portfolio holdings (if any) */}
          {(() => {
            const stocks = portfolioPositions.filter(p => p.asset_type !== "Stock Option")
            const options = portfolioPositions.filter(p => p.asset_type === "Stock Option")
            return (
              <>
                {stocks.length > 0 && <StockHoldingsTable positions={stocks} />}
                {options.length > 0 && <OptionsHoldingsTable positions={options} />}
              </>
            )
          })()}

          {/* Forecast plan (if any) */}
          {stockPlan && <StockPlanPanel plan={stockPlan} />}

          {/* Chart + Key Stats side by side */}
          <div className="grid grid-cols-2 gap-4">
            <PriceChartCard dates={historyDates} prices={historyPrices} loading={historyLoading} />
            <KeyStatsCard data={stockData} />
          </div>

          {/* Company about — full width */}
          <CompanyAboutCard data={stockData} />

          {/* Options chain — full width */}
          <OptionsChainPanel
            expiries={stockData.options_expiries}
            ticker={stockData.ticker}
            currentPrice={stockData.current_price}
            onAnalyse={handleAnalyse}
          />

          {/* News — full width */}
          <NewsCard news={news} error={newsError} />
        </>
      )}
    </div>
  )
}
