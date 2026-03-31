import { Link } from "react-router-dom"
import { auth } from "../firebase"

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
    href: null,
    label: "Watchlist",
    description: "Track your favourite tickers, monitor price movements, and get alerts when targets are hit.",
    available: false,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    accent: "sky",
    tag: "Coming soon",
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
    accent: "violet",
    tag: "Coming soon",
  },
]

const accentStyles = {
  indigo: {
    icon: "bg-indigo-500/15 border-indigo-500/20 text-indigo-400",
    hover: "hover:border-indigo-500/30 hover:bg-indigo-500/[0.04]",
    arrow: "text-indigo-400",
  },
  sky: {
    icon: "bg-sky-500/15 border-sky-500/20 text-sky-400",
    hover: "",
    arrow: "text-sky-400",
  },
  violet: {
    icon: "bg-violet-500/15 border-violet-500/20 text-violet-400",
    hover: "",
    arrow: "text-violet-400",
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

export default function DashboardPage() {
  const name = firstName()

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
              {/* Tag */}
              {f.tag && (
                <span className="absolute top-4 right-4 text-[10px] font-medium bg-white/5 border border-white/10 text-gray-600 rounded-full px-2 py-0.5">
                  {f.tag}
                </span>
              )}

              {/* Icon */}
              <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${styles.icon}`}>
                {f.icon}
              </div>

              {/* Text */}
              <div className="flex flex-col gap-1 flex-1">
                <h2 className="text-sm font-semibold text-white">{f.label}</h2>
                <p className="text-xs text-gray-500 leading-relaxed">{f.description}</p>
              </div>

              {/* Arrow */}
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
            <Link key={f.label} to={f.href}>
              {card}
            </Link>
          ) : (
            <div key={f.label}>{card}</div>
          )
        })}
      </div>
    </main>
  )
}