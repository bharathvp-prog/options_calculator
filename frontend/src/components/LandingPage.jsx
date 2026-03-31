import { Link } from "react-router-dom"

const features = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6.75v6.75" />
      </svg>
    ),
    title: "Multi-Leg Strategy Builder",
    desc: "Define each leg independently — ticker, expiry, strike, call or put. Build spreads, straddles, and condors with ease.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.652a3.75 3.75 0 010-5.304m5.304 0a3.75 3.75 0 010 5.304m-7.425 2.121a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12z" />
      </svg>
    ),
    title: "Live Yahoo Finance Data",
    desc: "Option chains fetched in real time. No stale data, no subscriptions, no API keys — just live market prices.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" />
      </svg>
    ),
    title: "Flexible Sorting",
    desc: "Sort by ask price, mid, or bid-ask spread. Instantly surface the most cost-efficient contract for every leg.",
  },
]

const steps = [
  {
    n: "01",
    label: "Build your strategy",
    desc: "Add legs one by one. Set the ticker, expiry window, strike range, and direction (call or put) for each.",
  },
  {
    n: "02",
    label: "Choose your metric",
    desc: "Pick how we rank contracts — cheapest ask, tightest spread, or best mid-market price.",
  },
  {
    n: "03",
    label: "Get your results",
    desc: "We scan the full live option chain and return the optimal contract per leg in seconds.",
  },
]

const stats = [
  { value: "Real-time", label: "market data" },
  { value: "Multi-leg", label: "strategy support" },
  { value: "3 clicks", label: "to find cheapest" },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">

      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-4 border-b border-white/5 bg-[#0a0a0f]/80 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-500 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white">
              <path d="M2.25 2.25a.75.75 0 000 1.5h1.386c.17 0 .318.114.362.278l2.558 9.592a3.752 3.752 0 00-2.806 3.63c0 .414.336.75.75.75h15.75a.75.75 0 000-1.5H5.378A2.25 2.25 0 017.5 15h11.218a.75.75 0 00.674-.421 60.358 60.358 0 002.96-7.228.75.75 0 00-.525-.965A60.864 60.864 0 005.68 4.509l-.232-.867A1.875 1.875 0 003.636 2.25H2.25z" />
            </svg>
          </div>
          <span className="text-base font-semibold tracking-tight">Oxas</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/login"
            className="px-4 py-1.5 text-sm font-medium text-gray-400 hover:text-white transition"
          >
            Log in
          </Link>
          <Link
            to="/login"
            className="px-4 py-1.5 text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition"
          >
            Get started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative flex flex-col items-center text-center px-6 pt-40 pb-28 overflow-hidden">
        {/* Background glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-indigo-600/20 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[400px] h-[300px] bg-violet-600/15 rounded-full blur-[80px] pointer-events-none" />

        <div className="relative z-10 flex flex-col items-center">
          <span className="mb-5 inline-flex items-center gap-2 px-3 py-1 text-xs font-medium text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
            Live market data · No subscription required
          </span>

          <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold leading-[1.05] tracking-tight max-w-4xl mb-6">
            Find the cheapest
            <br />
            <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-indigo-300 bg-clip-text text-transparent">
              options strategy
            </span>
            <br />
            in seconds.
          </h1>

          <p className="text-lg text-gray-400 max-w-lg mb-10 leading-relaxed">
            Build multi-leg options strategies and instantly surface the lowest-cost contracts from live Yahoo Finance data. Free, fast, no sign-up friction.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-3">
            <Link
              to="/login"
              className="px-7 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition shadow-lg shadow-indigo-500/20 text-sm"
            >
              Start for free →
            </Link>
            <a
              href="#how-it-works"
              className="px-7 py-3 text-gray-400 hover:text-white border border-white/10 hover:border-white/20 rounded-xl transition text-sm font-medium"
            >
              See how it works
            </a>
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-8 mt-16 pt-10 border-t border-white/5">
            {stats.map((s, i) => (
              <div key={i} className="text-center">
                <div className="text-xl font-bold text-white">{s.value}</div>
                <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Mock terminal / UI preview */}
      <section className="px-6 pb-24">
        <div className="max-w-3xl mx-auto">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden shadow-2xl shadow-black/50">
            {/* Window chrome */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-white/[0.02]">
              <div className="w-3 h-3 rounded-full bg-red-500/70" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
              <div className="w-3 h-3 rounded-full bg-green-500/70" />
              <span className="ml-3 text-xs text-gray-600 font-mono">Oxas — Strategy Builder</span>
            </div>
            {/* Content */}
            <div className="p-6 font-mono text-sm space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-gray-600 text-xs uppercase tracking-wider w-16">Leg 1</span>
                <span className="px-2 py-0.5 rounded-md bg-indigo-500/15 text-indigo-400 text-xs border border-indigo-500/20">AAPL</span>
                <span className="px-2 py-0.5 rounded-md bg-white/5 text-gray-400 text-xs border border-white/10">Call</span>
                <span className="px-2 py-0.5 rounded-md bg-white/5 text-gray-400 text-xs border border-white/10">Strike 180–200</span>
                <span className="px-2 py-0.5 rounded-md bg-white/5 text-gray-400 text-xs border border-white/10">30–60 days</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-gray-600 text-xs uppercase tracking-wider w-16">Leg 2</span>
                <span className="px-2 py-0.5 rounded-md bg-violet-500/15 text-violet-400 text-xs border border-violet-500/20">TSLA</span>
                <span className="px-2 py-0.5 rounded-md bg-white/5 text-gray-400 text-xs border border-white/10">Put</span>
                <span className="px-2 py-0.5 rounded-md bg-white/5 text-gray-400 text-xs border border-white/10">Strike 240–260</span>
                <span className="px-2 py-0.5 rounded-md bg-white/5 text-gray-400 text-xs border border-white/10">45–90 days</span>
              </div>
              <div className="pt-2 border-t border-white/5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-gray-500 text-xs">Sort by</span>
                  <span className="text-indigo-400 text-xs">Ask price (cheapest first)</span>
                </div>
                <div className="space-y-2">
                  {[
                    { ticker: "AAPL", contract: "AAPL240621C00185000", ask: "$1.23", spread: "0.04" },
                    { ticker: "TSLA", contract: "TSLA240621P00250000", ask: "$3.87", spread: "0.12" },
                  ].map((row, i) => (
                    <div key={i} className="flex items-center gap-4 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5">
                      <span className={`text-xs font-semibold ${i === 0 ? "text-indigo-400" : "text-violet-400"}`}>{row.ticker}</span>
                      <span className="text-gray-500 text-xs flex-1 truncate">{row.contract}</span>
                      <span className="text-green-400 text-xs font-semibold">{row.ask}</span>
                      <span className="text-gray-600 text-xs">spread {row.spread}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-24 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">Built for options traders</h2>
            <p className="text-gray-500 max-w-md mx-auto text-sm">Everything you need to find the cheapest entry for any strategy — nothing you don't.</p>
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
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">How it works</h2>
            <p className="text-gray-500 text-sm">Three steps from idea to cheapest contract.</p>
          </div>
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
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-24 border-t border-white/5">
        <div className="max-w-2xl mx-auto text-center relative">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] bg-indigo-600/10 rounded-full blur-[80px] pointer-events-none" />
          <div className="relative z-10">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              Start finding cheaper entries today.
            </h2>
            <p className="text-gray-500 mb-8 text-sm">
              Free to use. No credit card. Live market data on every search.
            </p>
            <Link
              to="/login"
              className="inline-block px-8 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition shadow-lg shadow-indigo-500/25 text-sm"
            >
              Get started for free →
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-8 py-6 border-t border-white/5 flex items-center justify-between text-xs text-gray-600">
        <span className="font-medium text-gray-500">Oxas</span>
        <span>© {new Date().getFullYear()} · Data via Yahoo Finance</span>
      </footer>
    </div>
  )
}
