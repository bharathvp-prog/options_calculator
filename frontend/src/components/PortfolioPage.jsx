import { useState, useEffect, useRef } from "react"
import { auth } from "../firebase"

async function getToken() {
  try {
    return await auth.currentUser?.getIdToken()
  } catch {
    return null
  }
}

const GROUP_ORDER = ["Stock Option", "Stock"]

function fmt(val, decimals = 2) {
  if (val === null || val === undefined) return "—"
  return Number(val).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function pnlColor(val) {
  if (val === null || val === undefined) return "text-gray-400"
  return val >= 0 ? "text-emerald-400" : "text-rose-400"
}

function LsBadge({ value }) {
  const isLong = value === "Long"
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${
      isLong
        ? "bg-sky-500/15 text-sky-400 border-sky-500/20"
        : "bg-amber-500/15 text-amber-400 border-amber-500/20"
    }`}>
      {value}
    </span>
  )
}

function CpBadge({ value }) {
  if (!value) return null
  const isCall = value === "Call"
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${
      isCall
        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
        : "bg-rose-500/15 text-rose-400 border-rose-500/20"
    }`}>
      {value}
    </span>
  )
}

// Inline SVG line chart for 14-day portfolio value
function PortfolioChart({ dates, values, width = 800, height = 100 }) {
  if (!dates || dates.length < 2) return null
  const pad = { top: 8, right: 12, bottom: 24, left: 56 }
  const w = width - pad.left - pad.right
  const h = height - pad.top - pad.bottom
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const positive = values[values.length - 1] >= values[0]
  const color = positive ? "#34d399" : "#fb7185"

  const pts = values.map((v, i) => {
    const x = pad.left + (i / (values.length - 1)) * w
    const y = pad.top + (1 - (v - min) / range) * h
    return [x, y]
  })
  const polylinePoints = pts.map(([x, y]) => `${x},${y}`).join(" ")

  // Area fill
  const areaPath = [
    `M ${pts[0][0]},${pad.top + h}`,
    ...pts.map(([x, y]) => `L ${x},${y}`),
    `L ${pts[pts.length - 1][0]},${pad.top + h}`,
    "Z",
  ].join(" ")

  // Y axis labels (min, mid, max)
  const mid = (min + max) / 2
  const yLabels = [
    { val: max, y: pad.top },
    { val: mid, y: pad.top + h / 2 },
    { val: min, y: pad.top + h },
  ]

  // X axis labels — show every ~3rd date
  const step = Math.max(1, Math.floor(dates.length / 5))
  const xLabels = dates
    .map((d, i) => ({ d, i }))
    .filter(({ i }) => i % step === 0 || i === dates.length - 1)

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }}>
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {yLabels.map(({ y }, i) => (
        <line key={i} x1={pad.left} y1={y} x2={pad.left + w} y2={y}
          stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
      ))}

      {/* Area fill */}
      <path d={areaPath} fill="url(#chartGrad)" />

      {/* Line */}
      <polyline points={polylinePoints} fill="none" stroke={color}
        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />

      {/* Dots at each point */}
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2" fill={color} opacity="0.7" />
      ))}

      {/* Last value dot (highlighted) */}
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]}
        r="3.5" fill={color} />

      {/* Y labels */}
      {yLabels.map(({ val, y }, i) => (
        <text key={i} x={pad.left - 6} y={y + 4} textAnchor="end"
          fontSize="9" fill="rgba(156,163,175,0.7)">
          {val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val.toFixed(0)}
        </text>
      ))}

      {/* X labels */}
      {xLabels.map(({ d, i }) => (
        <text key={i} x={pad.left + (i / (dates.length - 1)) * w} y={height - 2}
          textAnchor="middle" fontSize="9" fill="rgba(156,163,175,0.7)">
          {d.slice(5)}
        </text>
      ))}
    </svg>
  )
}

// Compute total portfolio value for each date using market_value_sgd
// We use FX-naive approach: sum of (qty * price) for stocks, market_value_sgd for options
// Simplest: for each date, for each position with a yf_ticker, scale market_value_sgd
// by (price[date] / current_price). Sum them up.
function computePortfolioTimeSeries(positions, dates, prices) {
  if (!dates || dates.length === 0) return []
  return dates.map((_, di) => {
    let total = 0
    for (const pos of positions) {
      const ticker = pos.yf_ticker
      const priceSeries = prices[ticker]
      if (!priceSeries || priceSeries.length === 0) {
        // No price data — use static market_value_sgd
        total += pos.market_value_sgd ?? 0
        continue
      }
      // Align: priceSeries may be shorter than dates if some dates had no data
      // We map by index relative to the tail
      const offset = dates.length - priceSeries.length
      const priceIdx = di - offset
      const historicPrice = priceIdx >= 0 ? priceSeries[priceIdx] : null
      const currentPrice = pos.current_price
      if (historicPrice !== null && currentPrice && currentPrice !== 0) {
        const scaledMv = (pos.market_value_sgd ?? 0) * (historicPrice / currentPrice)
        total += scaledMv
      } else {
        total += pos.market_value_sgd ?? 0
      }
    }
    return Math.round(total)
  })
}

function GroupTable({ assetType, positions }) {
  const isOptions = assetType === "Stock Option"
  const totalPnl = positions.reduce((s, p) => s + (p.pnl_sgd ?? 0), 0)
  const totalMv = positions.reduce((s, p) => s + (p.market_value_sgd ?? 0), 0)

  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.02] overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-white/5 bg-white/[0.02]">
        <span className="text-sm font-semibold text-white">{assetType}</span>
        <span className="text-xs text-gray-600 bg-white/5 border border-white/8 rounded-full px-2 py-0.5">
          {positions.length}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/5 text-gray-600 uppercase tracking-wider text-[10px]">
              <th className="text-left px-5 py-2.5 font-medium">Instrument</th>
              {isOptions && <th className="text-center px-3 py-2.5 font-medium">C/P</th>}
              {isOptions && <th className="text-right px-3 py-2.5 font-medium">Strike</th>}
              {isOptions && <th className="text-left px-3 py-2.5 font-medium">Expiry</th>}
              <th className="text-center px-3 py-2.5 font-medium">L/S</th>
              <th className="text-right px-3 py-2.5 font-medium">Qty</th>
              <th className="text-right px-3 py-2.5 font-medium">Open</th>
              <th className="text-right px-3 py-2.5 font-medium">Current</th>
              <th className="text-right px-3 py-2.5 font-medium">P&L (SGD)</th>
              <th className="text-right px-5 py-2.5 font-medium">Mkt Val (SGD)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.03]">
            {positions.map((p, i) => (
              <tr key={i} className="hover:bg-white/[0.02] transition">
                <td className="px-5 py-2.5 text-gray-300 max-w-[240px]">
                  <span title={p.instrument} className="truncate block">{p.instrument}</span>
                  {p.currency && p.currency !== "SGD" && (
                    <span className="text-gray-700 text-[9px]">{p.currency}</span>
                  )}
                </td>
                {isOptions && (
                  <td className="px-3 py-2.5 text-center"><CpBadge value={p.call_put} /></td>
                )}
                {isOptions && (
                  <td className="px-3 py-2.5 text-right text-gray-400">{fmt(p.strike)}</td>
                )}
                {isOptions && (
                  <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{p.expiry || "—"}</td>
                )}
                <td className="px-3 py-2.5 text-center"><LsBadge value={p.l_s} /></td>
                <td className="px-3 py-2.5 text-right text-gray-400">{fmt(p.quantity, 0)}</td>
                <td className="px-3 py-2.5 text-right text-gray-500">{fmt(p.open_price)}</td>
                <td className="px-3 py-2.5 text-right text-gray-400">{fmt(p.current_price)}</td>
                <td className={`px-3 py-2.5 text-right font-medium ${pnlColor(p.pnl_sgd)}`}>
                  {p.pnl_sgd !== null && p.pnl_sgd !== undefined
                    ? (p.pnl_sgd >= 0 ? "+" : "") + fmt(p.pnl_sgd)
                    : "—"}
                </td>
                <td className="px-5 py-2.5 text-right text-gray-300">{fmt(p.market_value_sgd)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-white/8 bg-white/[0.015]">
              <td colSpan={isOptions ? 8 : 4} className="px-5 py-2.5 text-xs font-medium text-gray-600 uppercase tracking-wider">
                Subtotal
              </td>
              <td className={`px-3 py-2.5 text-right text-sm font-semibold ${pnlColor(totalPnl)}`}>
                {(totalPnl >= 0 ? "+" : "") + fmt(totalPnl)}
              </td>
              <td className="px-5 py-2.5 text-right text-sm font-semibold text-white">
                {fmt(totalMv)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// Trend view: one row per position, columns = dates, value = market value that day
function TrendTable({ assetType, positions, dates, prices }) {
  const isOptions = assetType === "Stock Option"
  const totalPnl = positions.reduce((s, p) => s + (p.pnl_sgd ?? 0), 0)
  const totalMv = positions.reduce((s, p) => s + (p.market_value_sgd ?? 0), 0)

  // Compute per-date market value for a position
  function historicMv(pos, di) {
    const ticker = pos.yf_ticker
    const priceSeries = prices[ticker]
    if (!priceSeries || priceSeries.length === 0) return null
    const offset = dates.length - priceSeries.length
    const priceIdx = di - offset
    const historicPrice = priceIdx >= 0 ? priceSeries[priceIdx] : null
    const currentPrice = pos.current_price
    if (historicPrice !== null && currentPrice && currentPrice !== 0) {
      return (pos.market_value_sgd ?? 0) * (historicPrice / currentPrice)
    }
    return null
  }

  // Compute per-date total for this group
  function groupTotalForDate(di) {
    return positions.reduce((sum, pos) => {
      const mv = historicMv(pos, di)
      return sum + (mv !== null ? mv : (pos.market_value_sgd ?? 0))
    }, 0)
  }

  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.02] overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-white/5 bg-white/[0.02]">
        <span className="text-sm font-semibold text-white">{assetType}</span>
        <span className="text-xs text-gray-600 bg-white/5 border border-white/8 rounded-full px-2 py-0.5">
          {positions.length}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/5 text-gray-600 uppercase tracking-wider text-[10px]">
              <th className="text-left px-5 py-2.5 font-medium sticky left-0 bg-[#0a0a0f] z-10">Instrument</th>
              {isOptions && <th className="text-center px-3 py-2.5 font-medium">C/P</th>}
              {isOptions && <th className="text-right px-3 py-2.5 font-medium">Strike</th>}
              <th className="text-center px-3 py-2.5 font-medium">L/S</th>
              {dates.map(d => (
                <th key={d} className="text-right px-3 py-2.5 font-medium whitespace-nowrap">{d.slice(5)}</th>
              ))}
              <th className="text-right px-5 py-2.5 font-medium">P&L (SGD)</th>
              <th className="text-right px-5 py-2.5 font-medium">Mkt Val (SGD)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.03]">
            {positions.map((pos, i) => (
              <tr key={i} className="hover:bg-white/[0.02] transition">
                <td className="px-5 py-2.5 text-gray-300 max-w-[180px] sticky left-0 bg-[#0a0a0f]">
                  <span title={pos.instrument} className="truncate block">{pos.instrument}</span>
                </td>
                {isOptions && (
                  <td className="px-3 py-2.5 text-center"><CpBadge value={pos.call_put} /></td>
                )}
                {isOptions && (
                  <td className="px-3 py-2.5 text-right text-gray-400">{fmt(pos.strike)}</td>
                )}
                <td className="px-3 py-2.5 text-center"><LsBadge value={pos.l_s} /></td>
                {dates.map((_, di) => {
                  const mv = historicMv(pos, di)
                  return (
                    <td key={di} className="px-3 py-2.5 text-right text-gray-400 whitespace-nowrap">
                      {mv !== null ? fmt(mv, 0) : <span className="text-gray-700">—</span>}
                    </td>
                  )
                })}
                <td className={`px-3 py-2.5 text-right font-medium ${pnlColor(pos.pnl_sgd)}`}>
                  {pos.pnl_sgd !== null && pos.pnl_sgd !== undefined
                    ? (pos.pnl_sgd >= 0 ? "+" : "") + fmt(pos.pnl_sgd)
                    : "—"}
                </td>
                <td className="px-5 py-2.5 text-right text-gray-300">{fmt(pos.market_value_sgd)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-white/8 bg-white/[0.015]">
              <td
                colSpan={isOptions ? 3 : 2}
                className="px-5 py-2.5 text-xs font-medium text-gray-600 uppercase tracking-wider sticky left-0 bg-[#111117]"
              >
                Subtotal
              </td>
              {dates.map((_, di) => (
                <td key={di} className="px-3 py-2.5 text-right text-sm font-semibold text-white whitespace-nowrap">
                  {fmt(groupTotalForDate(di), 0)}
                </td>
              ))}
              <td className={`px-3 py-2.5 text-right text-sm font-semibold ${pnlColor(totalPnl)}`}>
                {(totalPnl >= 0 ? "+" : "") + fmt(totalPnl)}
              </td>
              <td className="px-5 py-2.5 text-right text-sm font-semibold text-white">
                {fmt(totalMv)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

export default function PortfolioPage() {
  const [positions, setPositions] = useState([])
  const [uploadedAt, setUploadedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [showUploadZone, setShowUploadZone] = useState(false)
  const [error, setError] = useState("")
  const [chartOpen, setChartOpen] = useState(false)
  const [showTrend, setShowTrend] = useState(false)
  const [priceDates, setPriceDates] = useState([])
  const [priceMap, setPriceMap] = useState({})
  const [pricesLoading, setPricesLoading] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => { fetchPortfolio() }, [])

  async function fetchPortfolio() {
    setLoading(true)
    try {
      const token = await getToken()
      const res = await fetch("/api/portfolio", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const data = await res.json()
      setPositions(data.positions || [])
      setUploadedAt(data.uploaded_at || null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function fetchPrices(days = 14) {
    setPricesLoading(true)
    try {
      const token = await getToken()
      const res = await fetch(`/api/portfolio/prices?days=${days}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const data = await res.json()
      setPriceDates(data.dates || [])
      setPriceMap(data.prices || {})
    } catch {
      // best-effort
    } finally {
      setPricesLoading(false)
    }
  }

  // Load prices when chart or trend is opened for the first time
  useEffect(() => {
    if ((chartOpen || showTrend) && priceDates.length === 0 && !pricesLoading) {
      fetchPrices(14)
    }
  }, [chartOpen, showTrend])

  async function handleFile(file) {
    if (!file) return
    if (!file.name.endsWith(".xlsx")) {
      setError("Please upload a .xlsx file exported from Saxo Bank.")
      return
    }
    setError("")
    setUploading(true)
    try {
      const token = await getToken()
      const formData = new FormData()
      formData.append("file", file)
      const res = await fetch("/api/portfolio/upload", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || "Upload failed")
      setShowUploadZone(false)
      setPriceDates([])
      setPriceMap({})
      await fetchPortfolio()
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  function onDragOver(e) { e.preventDefault(); setDragActive(true) }
  function onDragLeave() { setDragActive(false) }
  function onDrop(e) { e.preventDefault(); setDragActive(false); handleFile(e.dataTransfer.files[0]) }

  const grouped = positions.reduce((acc, pos) => {
    const g = pos.asset_type || "Other"
    if (!acc[g]) acc[g] = []
    acc[g].push(pos)
    return acc
  }, {})
  const orderedGroups = [
    ...GROUP_ORDER.filter(k => grouped[k]),
    ...Object.keys(grouped).filter(k => !GROUP_ORDER.includes(k)),
  ]

  const totalPnl = positions.reduce((s, p) => s + (p.pnl_sgd ?? 0), 0)
  const totalMv = positions.reduce((s, p) => s + (p.market_value_sgd ?? 0), 0)

  // 14-day portfolio value time series
  const chartValues = computePortfolioTimeSeries(positions, priceDates, priceMap)
  // Use the last 7 dates for trend view
  const trendDates = priceDates.slice(-7)
  const trendOffset = priceDates.length - trendDates.length

  const UploadZone = (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`border-2 border-dashed rounded-2xl p-12 text-center transition cursor-pointer ${
        dragActive
          ? "border-indigo-500/60 bg-indigo-500/[0.06]"
          : "border-white/10 bg-white/[0.02] hover:border-white/20"
      }`}
      onClick={() => fileInputRef.current?.click()}
    >
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-6 h-6 text-indigo-400">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-medium text-white mb-1">
            {uploading ? "Uploading…" : "Drop your Saxo Bank export here"}
          </p>
          <p className="text-xs text-gray-600">
            Export from Saxo Bank → Positions → Export (.xlsx)
          </p>
        </div>
        <button
          onClick={e => { e.stopPropagation(); fileInputRef.current?.click() }}
          disabled={uploading}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-xl transition"
        >
          Choose file
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={e => handleFile(e.target.files[0])}
      />
    </div>
  )

  return (
    <main className="max-w-7xl mx-auto px-6 pt-12 pb-16 flex flex-col gap-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-indigo-400 uppercase tracking-widest mb-2">Portfolio</p>
          <h1 className="text-3xl font-bold text-white">Holdings</h1>
          {uploadedAt && (
            <p className="text-gray-600 mt-1.5 text-sm">
              Last updated {new Date(uploadedAt).toLocaleString()}
            </p>
          )}
        </div>
        {positions.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowTrend(v => !v)}
              className={`text-sm border rounded-xl px-4 py-2 transition ${
                showTrend
                  ? "text-indigo-300 border-indigo-500/40 bg-indigo-500/10"
                  : "text-gray-500 hover:text-gray-300 border-white/10 hover:border-white/20"
              }`}
            >
              {showTrend ? "Hide trend" : "Show trend"}
            </button>
            <button
              onClick={() => setShowUploadZone(v => !v)}
              className="text-sm text-gray-500 hover:text-gray-300 border border-white/10 hover:border-white/20 rounded-xl px-4 py-2 transition"
            >
              {showUploadZone ? "Cancel" : "Update portfolio"}
            </button>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3 text-sm text-rose-400">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 rounded-xl bg-white/[0.03] animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && positions.length === 0 && UploadZone}

      {/* Replace upload zone */}
      {!loading && positions.length > 0 && showUploadZone && (
        <div>{UploadZone}</div>
      )}

      {/* 14-day portfolio value chart (collapsible) */}
      {!loading && positions.length > 0 && (
        <div className="bg-white/[0.02] border border-white/8 rounded-2xl overflow-hidden">
          <button
            onClick={() => setChartOpen(v => !v)}
            className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/[0.02] transition"
          >
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-white">14-day Portfolio Value</span>
              {chartValues.length > 0 && (() => {
                const delta = chartValues[chartValues.length - 1] - chartValues[0]
                const pct = chartValues[0] !== 0 ? (delta / Math.abs(chartValues[0])) * 100 : 0
                return (
                  <span className={`text-xs font-medium ${delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {delta >= 0 ? "+" : ""}{fmt(delta, 0)} SGD ({pct >= 0 ? "+" : ""}{pct.toFixed(1)}%)
                  </span>
                )
              })()}
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              className={`w-4 h-4 text-gray-600 transition-transform ${chartOpen ? "rotate-180" : ""}`}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>

          {chartOpen && (
            <div className="px-4 pb-4 border-t border-white/5">
              {pricesLoading ? (
                <div className="h-24 flex items-center justify-center">
                  <div className="h-1.5 w-24 rounded bg-white/10 animate-pulse" />
                </div>
              ) : chartValues.length >= 2 ? (
                <div className="pt-4">
                  <PortfolioChart dates={priceDates} values={chartValues} height={110} />
                </div>
              ) : (
                <p className="text-xs text-gray-600 py-6 text-center">Not enough price data available.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Summary stats */}
      {!loading && positions.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white/[0.02] border border-white/8 rounded-2xl px-5 py-4">
            <p className="text-xs text-gray-600 uppercase tracking-wider mb-1">Positions</p>
            <p className="text-2xl font-bold text-white">{positions.length}</p>
          </div>
          <div className="bg-white/[0.02] border border-white/8 rounded-2xl px-5 py-4">
            <p className="text-xs text-gray-600 uppercase tracking-wider mb-1">Total P&L (SGD)</p>
            <p className={`text-2xl font-bold ${pnlColor(totalPnl)}`}>
              {(totalPnl >= 0 ? "+" : "") + fmt(totalPnl)}
            </p>
          </div>
          <div className="bg-white/[0.02] border border-white/8 rounded-2xl px-5 py-4">
            <p className="text-xs text-gray-600 uppercase tracking-wider mb-1">Market Value (SGD)</p>
            <p className="text-2xl font-bold text-white">{fmt(totalMv)}</p>
          </div>
        </div>
      )}

      {/* Grouped tables — normal or trend view */}
      {!loading && !showTrend && orderedGroups.map(group => (
        <GroupTable key={group} assetType={group} positions={grouped[group]} />
      ))}

      {!loading && showTrend && (
        <>
          {pricesLoading && (
            <div className="flex flex-col gap-3">
              {[1, 2].map(i => (
                <div key={i} className="h-16 rounded-xl bg-white/[0.03] animate-pulse" />
              ))}
            </div>
          )}
          {!pricesLoading && orderedGroups.map(group => (
            <TrendTable
              key={group}
              assetType={group}
              positions={grouped[group]}
              dates={trendDates}
              prices={priceMap}
            />
          ))}
        </>
      )}
    </main>
  )
}
