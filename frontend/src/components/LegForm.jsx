import { useState } from "react"

const defaultLeg = {
  ticker: "",
  expiry_from: "",
  expiry_to: "",
  strike_min: "",
  strike_max: "",
  option_type: "call",
  side: "buy",
}

export default function LegForm({ onAdd }) {
  const [leg, setLeg] = useState(defaultLeg)
  const [tickerStatus, setTickerStatus] = useState("idle") // idle | loading | valid | invalid
  const [expiries, setExpiries] = useState([]) // available expiry dates from Yahoo

  const set = (field, value) => setLeg((prev) => ({ ...prev, [field]: value }))

  const handleTickerBlur = async () => {
    if (!leg.ticker) return
    setTickerStatus("loading")
    try {
      const res = await fetch(`/api/options/expiries?ticker=${leg.ticker.toUpperCase()}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      if (!data.expiries?.length) throw new Error()
      setExpiries(data.expiries)
      setTickerStatus("valid")
      // Auto-fill expiry range with first and last available date
      setLeg((prev) => ({
        ...prev,
        expiry_from: prev.expiry_from || data.expiries[0],
        expiry_to: prev.expiry_to || data.expiries[data.expiries.length - 1],
      }))
    } catch {
      setTickerStatus("invalid")
      setExpiries([])
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!leg.ticker || !leg.expiry_from || !leg.expiry_to) return
    if (tickerStatus === "invalid") return
    onAdd({
      ...leg,
      ticker: leg.ticker.toUpperCase(),
      strike_min: leg.strike_min !== "" ? parseFloat(leg.strike_min) : null,
      strike_max: leg.strike_max !== "" ? parseFloat(leg.strike_max) : null,
    })
    setLeg(defaultLeg)
    setTickerStatus("idle")
    setExpiries([])
  }

  const inputClass =
    "w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition"

  const labelClass = "block text-xs font-medium text-gray-500 mb-1.5"

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white/[0.02] border border-white/8 rounded-2xl p-6"
    >
      <h2 className="text-sm font-semibold text-white mb-5 flex items-center gap-2">
        <span className="w-5 h-5 rounded-md bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 text-indigo-400">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </span>
        Add a leg
      </h2>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {/* Ticker */}
        <div className="col-span-2 md:col-span-1">
          <label className={labelClass}>Ticker</label>
          <div className="relative">
            <input
              type="text"
              value={leg.ticker}
              onChange={(e) => {
                set("ticker", e.target.value)
                setTickerStatus("idle")
                setExpiries([])
              }}
              onBlur={handleTickerBlur}
              required
              placeholder="e.g. AAPL"
              className={
                inputClass +
                " uppercase pr-8 " +
                (tickerStatus === "invalid" ? "border-rose-500/50 focus:ring-rose-500/50" : "")
              }
            />
            {/* Status indicator */}
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
              {tickerStatus === "loading" && (
                <span className="w-3.5 h-3.5 border-2 border-gray-500 border-t-indigo-400 rounded-full animate-spin block" />
              )}
              {tickerStatus === "valid" && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5 text-emerald-400">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              )}
              {tickerStatus === "invalid" && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5 text-rose-400">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </div>
          </div>
          {tickerStatus === "invalid" && (
            <p className="text-xs text-rose-400 mt-1">Ticker not found on Yahoo Finance</p>
          )}
          {tickerStatus === "valid" && expiries.length > 0 && (
            <p className="text-xs text-gray-600 mt-1">{expiries.length} expiry dates available</p>
          )}
        </div>

        {/* Call / Put */}
        <div className="flex flex-col gap-1.5">
          <label className={labelClass}>Type</label>
          <div className="flex gap-2">
            {["call", "put"].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => set("option_type", t)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition capitalize ${
                  leg.option_type === t
                    ? t === "call"
                      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                      : "bg-rose-500/15 text-rose-400 border-rose-500/30"
                    : "bg-white/5 text-gray-500 border-white/10 hover:bg-white/8 hover:text-gray-400"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Buy / Sell */}
        <div className="flex flex-col gap-1.5">
          <label className={labelClass}>Side</label>
          <div className="flex gap-2">
            {["buy", "sell"].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => set("side", s)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition capitalize ${
                  leg.side === s
                    ? s === "buy"
                      ? "bg-sky-500/15 text-sky-400 border-sky-500/30"
                      : "bg-amber-500/15 text-amber-400 border-amber-500/30"
                    : "bg-white/5 text-gray-500 border-white/10 hover:bg-white/8 hover:text-gray-400"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Expiry From */}
        <div>
          <label className={labelClass}>Expiry from</label>
          {expiries.length > 0 ? (
            <select
              value={leg.expiry_from}
              onChange={(e) => set("expiry_from", e.target.value)}
              required
              className={inputClass + " [color-scheme:dark]"}
            >
              {expiries.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          ) : (
            <input
              type="date"
              value={leg.expiry_from}
              onChange={(e) => set("expiry_from", e.target.value)}
              required
              className={inputClass + " [color-scheme:dark]"}
            />
          )}
        </div>

        {/* Expiry To */}
        <div>
          <label className={labelClass}>Expiry to</label>
          {expiries.length > 0 ? (
            <select
              value={leg.expiry_to}
              onChange={(e) => set("expiry_to", e.target.value)}
              required
              className={inputClass + " [color-scheme:dark]"}
            >
              {expiries.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          ) : (
            <input
              type="date"
              value={leg.expiry_to}
              onChange={(e) => set("expiry_to", e.target.value)}
              required
              className={inputClass + " [color-scheme:dark]"}
            />
          )}
        </div>

        <div className="hidden md:block" />

        {/* Strike Min */}
        <div>
          <label className={labelClass}>Strike min ($)</label>
          <input
            type="number"
            value={leg.strike_min}
            onChange={(e) => set("strike_min", e.target.value)}
            placeholder="Any"
            min="0"
            step="0.5"
            className={inputClass}
          />
        </div>

        {/* Strike Max */}
        <div>
          <label className={labelClass}>Strike max ($)</label>
          <input
            type="number"
            value={leg.strike_max}
            onChange={(e) => set("strike_max", e.target.value)}
            placeholder="Any"
            min="0"
            step="0.5"
            className={inputClass}
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={tickerStatus === "invalid" || tickerStatus === "loading"}
        className="mt-5 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl transition shadow-lg shadow-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        + Add leg
      </button>
    </form>
  )
}
