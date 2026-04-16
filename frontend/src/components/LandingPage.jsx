import { useEffect } from "react"
import { Link } from "react-router-dom"

const CandlestickLogo = ({ className = "w-4 h-4" }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none">
    <rect x="3" y="8" width="3" height="8" rx="0.5" fill="white" />
    <line x1="4.5" y1="5" x2="4.5" y2="8" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="4.5" y1="16" x2="4.5" y2="19" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    <rect x="10.5" y="5" width="3" height="10" rx="0.5" fill="white" />
    <line x1="12" y1="3" x2="12" y2="5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="12" y1="15" x2="12" y2="19" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    <rect x="18" y="7" width="3" height="7" rx="0.5" fill="white" />
    <line x1="19.5" y1="4" x2="19.5" y2="7" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="19.5" y1="14" x2="19.5" y2="18" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

const features = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
      </svg>
    ),
    title: "Options Wheeling",
    desc: "Identify uncovered stock positions in your portfolio and scan live chains for the richest covered call premium — ranked by yield and strike.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
      </svg>
    ),
    title: "Portfolio Management",
    desc: "Upload your Saxo Bank export. Track live P&L, 14-day price trends with day-over-day colour coding, and an inline portfolio value chart.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803a7.5 7.5 0 0010.607 0z" />
      </svg>
    ),
    title: "Stock Research",
    desc: "Look up any ticker for live price, options availability, and key stats — then jump straight into wheeling analysis with one click.",
  },
]

const steps = [
  {
    n: "01",
    label: "Upload your portfolio",
    desc: "Drop in your Saxo Bank .xlsx export. ArkenVault maps every position to live Yahoo Finance data automatically.",
  },
  {
    n: "02",
    label: "Find wheeling opportunities",
    desc: "The Options Wheeling page flags uncovered stock positions and surfaces the richest available covered calls ranked by premium yield.",
  },
  {
    n: "03",
    label: "Track and repeat",
    desc: "Monitor P&L, refresh prices daily, and compound premium income over time — all from one dashboard.",
  },
]

const mockWheelRows = [
  { expiry: "Jun 2025", strike: "$200C", premium: "$4.20", yield: "2.1%", best: true },
  { expiry: "Jun 2025", strike: "$210C", premium: "$2.85", yield: "1.4%", best: false },
  { expiry: "May 2025", strike: "$195C", premium: "$6.10", yield: "3.1%", best: false },
]

const trendRows = [
  { name: "AMD", type: "Stock", days: ["e", "r", "e", "e", "r"] },
  { name: "NVDA", type: "Stock", days: ["e", "e", "r", "e", "e"] },
  { name: "AMD 200C", type: "Option", days: ["r", "e", "e", "r", "e"] },
]

export default function LandingPage() {
  useEffect(() => {
    const html = document.documentElement
    const hadLight = html.classList.contains("light")
    html.classList.remove("light")
    return () => { if (hadLight) html.classList.add("light") }
  }, [])

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">

      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-4 border-b border-white/5 bg-[#0a0a0f]/80 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-500 flex items-center justify-center shrink-0">
            <CandlestickLogo />
          </div>
          <span className="text-base font-semibold tracking-tight">ArkenVault</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/login" className="px-4 py-1.5 text-sm font-medium text-gray-400 hover:text-white transition">
            Log in
          </Link>
          <Link to="/login" className="px-4 py-1.5 text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition">
            Get started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative flex flex-col items-center text-center px-6 pt-40 pb-24 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-indigo-600/20 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[400px] h-[300px] bg-violet-600/15 rounded-full blur-[80px] pointer-events-none" />

        <div className="relative z-10 flex flex-col items-center">
          <span className="mb-5 inline-flex items-center gap-2 px-3 py-1 text-xs font-medium text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
            Live market data · No subscription required
          </span>

          <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold leading-[1.05] tracking-tight max-w-4xl mb-6">
            Options wheeling,
            <br />
            <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-indigo-300 bg-clip-text text-transparent">
              made simple.
            </span>
          </h1>

          <p className="text-lg text-gray-400 max-w-lg mb-10 leading-relaxed">
            Build covered call and cash-secured put strategies, manage your portfolio, and research stocks — all in one place.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-3">
            <Link
              to="/login"
              className="px-7 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition shadow-lg shadow-indigo-500/20 text-sm"
            >
              Get started free →
            </Link>
            <a
              href="#how-it-works"
              className="px-7 py-3 text-gray-400 hover:text-white border border-white/10 hover:border-white/20 rounded-xl transition text-sm font-medium"
            >
              See how it works
            </a>
          </div>
        </div>
      </section>

      {/* Mock wheeling UI */}
      <section className="px-6 pb-24">
        <div className="max-w-2xl mx-auto">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden shadow-2xl shadow-black/50">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-white/[0.02]">
              <div className="w-3 h-3 rounded-full bg-red-500/70" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
              <div className="w-3 h-3 rounded-full bg-green-500/70" />
              <span className="ml-3 text-xs text-gray-600 font-mono">ArkenVault — Options Wheeling</span>
            </div>
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <span className="text-sm font-semibold text-white">AMD</span>
                  <span className="ml-2 text-xs text-gray-500">500 shares · uncovered</span>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-400 text-xs border border-amber-500/20">Sell covered calls</span>
              </div>
              <div className="rounded-xl border border-white/8 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/5">
                      <th className="px-3 py-2 text-left text-gray-600 font-medium">Expiry</th>
                      <th className="px-3 py-2 text-left text-gray-600 font-medium">Strike</th>
                      <th className="px-3 py-2 text-left text-gray-600 font-medium">Premium</th>
                      <th className="px-3 py-2 text-left text-gray-600 font-medium">Yield</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mockWheelRows.map((row, i) => (
                      <tr
                        key={i}
                        className={`border-b border-white/5 last:border-0 ${row.best ? "bg-emerald-500/5" : ""}`}
                      >
                        <td className="px-3 py-2.5 text-gray-400">{row.expiry}</td>
                        <td className="px-3 py-2.5 text-gray-300 font-mono">{row.strike}</td>
                        <td className="px-3 py-2.5 text-emerald-400 font-semibold">{row.premium}</td>
                        <td className="px-3 py-2.5">
                          <span className="text-gray-300">{row.yield}</span>
                          {row.best && (
                            <span className="ml-2 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 text-[10px]">Best yield</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-24 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">Everything you need</h2>
            <p className="text-gray-500 max-w-md mx-auto text-sm">From wheeling strategies to portfolio tracking and stock research — one tool, no noise.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {features.map((f) => (
              <div
                key={f.title}
                className="group p-6 rounded-2xl border border-white/8 bg-white/[0.02] hover:bg-white/[0.04] hover:border-indigo-500/30 transition-all duration-300"
              >
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-5 group-hover:bg-indigo-500/20 transition-colors">
                  {f.icon}
                </div>
                <h3 className="font-semibold text-white mb-2 text-sm">{f.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="px-6 py-24 border-t border-white/5">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">How it works</h2>
            <p className="text-gray-500 text-sm">Three steps from upload to compounding premium income.</p>
          </div>
          <div className="grid md:grid-cols-2 gap-10 items-start">
            <div className="relative">
              <div className="absolute left-[19px] top-5 bottom-5 w-px bg-gradient-to-b from-indigo-500/40 via-violet-500/20 to-transparent" />
              <div className="flex flex-col gap-8">
                {steps.map((s) => (
                  <div key={s.n} className="flex gap-6 items-start">
                    <div className="flex-shrink-0 w-10 h-10 rounded-full border border-indigo-500/40 bg-indigo-500/10 flex items-center justify-center relative z-10">
                      <span className="text-indigo-400 text-xs font-bold">{s.n}</span>
                    </div>
                    <div className="pt-1.5">
                      <h3 className="font-semibold text-white text-sm mb-1">{s.label}</h3>
                      <p className="text-gray-500 text-sm leading-relaxed">{s.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Decorative comparison table */}
            <div className="rounded-2xl border border-white/8 bg-white/[0.02] overflow-hidden">
              <div className="px-4 py-3 border-b border-white/5 text-xs text-gray-600 font-mono">AMD · Covered Call Scan</div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="px-4 py-2.5 text-left text-gray-600 font-medium">Expiry</th>
                    <th className="px-4 py-2.5 text-left text-gray-600 font-medium">Strike</th>
                    <th className="px-4 py-2.5 text-left text-gray-600 font-medium">Premium</th>
                    <th className="px-4 py-2.5 text-left text-gray-600 font-medium">Yield</th>
                  </tr>
                </thead>
                <tbody>
                  {mockWheelRows.map((row, i) => (
                    <tr key={i} className={`border-b border-white/5 last:border-0 ${row.best ? "bg-emerald-500/5" : ""}`}>
                      <td className="px-4 py-3 text-gray-400">{row.expiry}</td>
                      <td className="px-4 py-3 text-gray-300 font-mono">{row.strike}</td>
                      <td className="px-4 py-3 text-emerald-400 font-semibold">{row.premium}</td>
                      <td className="px-4 py-3">
                        <span className="text-gray-300">{row.yield}</span>
                        {row.best && <span className="ml-2 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 text-[10px]">Best yield</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* Portfolio callout */}
      <section className="px-6 py-24 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-8 md:p-10 grid md:grid-cols-2 gap-10 items-center">
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-4">14-day trend, always live.</h2>
              <p className="text-gray-400 text-sm leading-relaxed mb-6">
                Every position in your Saxo Bank portfolio tracked with live prices, day-over-day colour coding, and a running total value chart.
              </p>
              <ul className="space-y-2.5 text-sm">
                {[
                  "Live prices via Yahoo Finance",
                  "Day-over-day colour coding (green/red)",
                  "Covered call opportunities flagged automatically",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2.5 text-gray-400">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-emerald-400 shrink-0">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Decorative trend table */}
            <div className="rounded-xl border border-white/8 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-white/5 text-xs text-gray-600">Portfolio · 5-day trend</div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="px-3 py-2 text-left text-gray-600 font-medium">Position</th>
                    {["M", "T", "W", "T", "F"].map((d, i) => (
                      <th key={i} className="px-2 py-2 text-center text-gray-600 font-medium">{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trendRows.map((row) => (
                    <tr key={row.name} className="border-b border-white/5 last:border-0">
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-gray-300">{row.name}</div>
                        <div className="text-gray-600 text-[10px]">{row.type}</div>
                      </td>
                      {row.days.map((d, i) => (
                        <td key={i} className="px-2 py-2.5 text-center">
                          <span className={`inline-block w-6 h-5 rounded text-[10px] font-semibold leading-5 ${d === "e" ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"}`}>
                            {d === "e" ? "▲" : "▼"}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="px-6 py-24 border-t border-white/5">
        <div className="max-w-2xl mx-auto text-center relative">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] bg-indigo-600/10 rounded-full blur-[80px] pointer-events-none" />
          <div className="relative z-10">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              Start wheeling today.
            </h2>
            <p className="text-gray-500 mb-8 text-sm">Free. No subscription required.</p>
            <Link
              to="/login"
              className="inline-block px-8 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition shadow-lg shadow-indigo-500/25 text-sm"
            >
              Start wheeling →
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-8 py-6 border-t border-white/5 flex items-center justify-between text-xs text-gray-600">
        <span className="font-medium text-gray-500">ArkenVault</span>
        <span>© {new Date().getFullYear()}</span>
      </footer>
    </div>
  )
}
