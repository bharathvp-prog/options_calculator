import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { auth } from "../firebase"

async function getToken() {
  try {
    return await auth.currentUser?.getIdToken()
  } catch {
    return null
  }
}

const FEATURES = [
  {
    href: "/app/options",
    label: "Options Builder",
    description: "Define a multi-leg strategy, scan live option chains, and surface the cheapest matching contracts.",
    available: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
    accent: "indigo",
    tag: null,
  },
  {
    href: "/app/portfolio",
    label: "Portfolio",
    description: "Upload your Saxo Bank holdings export, track positions by type, and monitor live P&L and trendlines.",
    available: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
      </svg>
    ),
    accent: "violet",
    tag: null,
  },
  {
    href: null,
    label: "Screener",
    description: "Screen thousands of options contracts by IV, volume, open interest, and custom filters.",
    available: false,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
      </svg>
    ),
    accent: "sky",
    tag: "Coming soon",
  },
]

const accentStyles = {
  indigo: {
    icon: "bg-indigo-500/15 border-indigo-500/20 text-indigo-400",
    hover: "hover:border-indigo-500/30 hover:bg-indigo-500/[0.04]",
    arrow: "text-indigo-400",
  },
  violet: {
    icon: "bg-violet-500/15 border-violet-500/20 text-violet-400",
    hover: "hover:border-violet-500/30 hover:bg-violet-500/[0.04]",
    arrow: "text-violet-400",
  },
  sky: {
    icon: "bg-sky-500/15 border-sky-500/20 text-sky-400",
    hover: "",
    arrow: "text-sky-400",
  },
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return "Good morning"
  if (h < 17) return "Good afternoon"
  return "Good evening"
}

function firstName() {
  const user = auth.currentUser
  if (!user) return null
  if (user.displayName) return user.displayName.split(" ")[0]
  return null
}

function Sparkline({ prices, width = 80, height = 28 }) {
  if (!prices || prices.length < 2) {
    return <div style={{ width, height }} className="bg-white/5 rounded" />
  }
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1
  const pad = 2
  const w = width - pad * 2
  const h = height - pad * 2
  const points = prices
    .map((p, i) => {
      const x = pad + (i / (prices.length - 1)) * w
      const y = pad + (1 - (p - min) / range) * h
      return `${x},${y}`
    })
    .join(" ")
  const positive = prices[prices.length - 1] >= prices[0]
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline
        points={points}
        fill="none"
        stroke={positive ? "#34d399" : "#fb7185"}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function AssetTypeBadge({ type }) {
  const isOption = type === "Stock Option"
  return (
    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded border ${
      isOption
        ? "bg-indigo-500/10 text-indigo-500 border-indigo-500/15"
        : "bg-white/5 text-gray-600 border-white/8"
    }`}>
      {isOption ? "Option" : type}
    </span>
  )
}

export default function DashboardPage() {
  const name = firstName()
  const [portfolioPositions, setPortfolioPositions] = useState(null)
  const [portfolioPrices, setPortfolioPrices] = useState({})
  const [portfolioLoaded, setPortfolioLoaded] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken()
        const headers = token ? { Authorization: `Bearer ${token}` } : {}
        const posRes = await fetch("/api/portfolio", { headers })
        const posData = await posRes.json()
        setPortfolioPositions(posData.positions || [])
        if ((posData.positions || []).length > 0) {
          try {
            const priceRes = await fetch("/api/portfolio/prices", { headers })
            const priceData = await priceRes.json()
            setPortfolioPrices(priceData.prices || {})
          } catch {
            // prices are best-effort
          }
        }
      } catch {
        setPortfolioPositions([])
      } finally {
        setPortfolioLoaded(true)
      }
    }
    load()
  }, [])

  const displayPositions = (portfolioPositions || []).slice(0, 10)

  return (
    <main className="max-w-4xl mx-auto px-6 pt-16 pb-16 flex flex-col gap-10">
      {/* Header */}
      <div>
        <p className="text-xs font-medium text-indigo-400 uppercase tracking-widest mb-2">Dashboard</p>
        <h1 className="text-3xl font-bold text-white">
          {greeting()}{name ? `, ${name}` : ""}.
        </h1>
        <p className="text-gray-500 mt-2 text-base">What do you feel like doing today?</p>
      </div>

      {/* Feature cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {FEATURES.map((f) => {
          const styles = accentStyles[f.accent]
          const card = (
            <div
              className={`relative flex flex-col gap-4 p-5 rounded-2xl border border-white/8 bg-white/[0.02] transition ${
                f.available ? `cursor-pointer ${styles.hover}` : "opacity-50 cursor-default"
              }`}
            >
              {f.tag && (
                <span className="absolute top-4 right-4 text-[10px] font-medium bg-white/5 border border-white/10 text-gray-600 rounded-full px-2 py-0.5">
                  {f.tag}
                </span>
              )}
              <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${styles.icon}`}>
                {f.icon}
              </div>
              <div className="flex flex-col gap-1 flex-1">
                <h2 className="text-sm font-semibold text-white">{f.label}</h2>
                <p className="text-xs text-gray-500 leading-relaxed">{f.description}</p>
              </div>
              {f.available && (
                <div className={`flex items-center gap-1 text-xs font-medium ${styles.arrow}`}>
                  Open
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                </div>
              )}
            </div>
          )
          return f.available ? (
            <Link key={f.label} to={f.href}>{card}</Link>
          ) : (
            <div key={f.label}>{card}</div>
          )
        })}
      </div>

      {/* Portfolio widget */}
      <div className="bg-white/[0.02] border border-white/8 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h2 className="text-sm font-semibold text-white">Portfolio Overview</h2>
          <Link to="/app/portfolio" className="text-xs text-indigo-400 hover:text-indigo-300 transition">
            View all →
          </Link>
        </div>

        {!portfolioLoaded && (
          <div className="flex flex-col gap-2 p-5">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-9 rounded-lg bg-white/[0.03] animate-pulse" />
            ))}
          </div>
        )}

        {portfolioLoaded && portfolioPositions?.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-10 px-5">
            <p className="text-sm text-gray-600">No portfolio uploaded yet.</p>
            <Link
              to="/app/portfolio"
              className="text-sm text-indigo-400 hover:text-indigo-300 transition flex items-center gap-1"
            >
              Upload your Saxo Bank export
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </Link>
          </div>
        )}

        {portfolioLoaded && portfolioPositions?.length > 0 && (
          <div className="divide-y divide-white/[0.03]">
            <div className="grid grid-cols-[1fr_80px_90px_80px_90px] gap-2 px-5 py-2 text-[10px] font-medium text-gray-700 uppercase tracking-wider">
              <span>Instrument</span>
              <span className="text-center">Type</span>
              <span className="text-right">Price (yf)</span>
              <span className="text-center">7d</span>
              <span className="text-right">P&L (SGD)</span>
            </div>

            {displayPositions.map((pos, i) => {
              const sparkData = portfolioPrices[pos.yf_ticker] || []
              const currentPrice = sparkData.length > 0 ? sparkData[sparkData.length - 1] : null
              const pnl = pos.pnl_sgd

              return (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_80px_90px_80px_90px] gap-2 items-center px-5 py-2.5 hover:bg-white/[0.02] transition"
                >
                  <p className="text-xs text-gray-300 truncate" title={pos.instrument}>
                    {pos.instrument}
                  </p>
                  <div className="flex justify-center">
                    <AssetTypeBadge type={pos.asset_type} />
                  </div>
                  <div className="text-right text-xs text-gray-400">
                    {currentPrice !== null
                      ? currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                      : "—"}
                  </div>
                  <div className="flex justify-center">
                    <Sparkline prices={sparkData} />
                  </div>
                  <div className={`text-right text-xs font-medium ${pnl !== null && pnl !== undefined ? (pnl >= 0 ? "text-emerald-400" : "text-rose-400") : "text-gray-600"}`}>
                    {pnl !== null && pnl !== undefined
                      ? (pnl >= 0 ? "+" : "") + pnl.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
                      : "—"}
                  </div>
                </div>
              )
            })}

            {(portfolioPositions?.length || 0) > 10 && (
              <div className="px-5 py-3 text-center">
                <Link to="/app/portfolio" className="text-xs text-gray-600 hover:text-gray-400 transition">
                  +{portfolioPositions.length - 10} more positions — view all
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
