import { useState, useEffect, useRef } from "react"

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
  const [query, setQuery] = useState("")           // raw input text
  const [suggestions, setSuggestions] = useState([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [expiries, setExpiries] = useState([])
  const [expiryStatus, setExpiryStatus] = useState("idle") // idle | loading | done | error
  const debounceRef = useRef(null)
  const dropdownRef = useRef(null)

  const set = (field, value) => setLeg((prev) => ({ ...prev, [field]: value }))

  // Debounced ticker search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query) { setSuggestions([]); return }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tickers/search?q=${encodeURIComponent(query)}`)
        const data = await res.json()
        setSuggestions(data.results || [])
        setShowDropdown(true)
      } catch {
        setSuggestions([])
      }
    }, 200)
    return () => clearTimeout(debounceRef.current)
  }, [query])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const selectTicker = async (symbol) => {
    setQuery(symbol)
    set("ticker", symbol)
    setSuggestions([])
    setShowDropdown(false)
    // Fetch expiries immediately on selection
    setExpiryStatus("loading")
    try {
      const res = await fetch(`/api/options/expiries?ticker=${symbol}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      if (!data.expiries?.length) throw new Error()
      setExpiries(data.expiries)
      setExpiryStatus("done")
      setLeg((prev) => ({
        ...prev,
        ticker: symbol,
        expiry_from: data.expiries[0],
        expiry_to: data.expiries[data.expiries.length - 1],
      }))
    } catch {
      setExpiryStatus("error")
      setExpiries([])
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!leg.ticker || !leg.expiry_from || !leg.expiry_to) return
    onAdd({
      ...leg,
      ticker: leg.ticker.toUpperCase(),
      strike_min: leg.strike_min !== "" ? parseFloat(leg.strike_min) : null,
      strike_max: leg.strike_max !== "" ? parseFloat(leg.strike_max) : null,
    })
    setLeg(defaultLeg)
    setQuery("")
    setExpiries([])
    setExpiryStatus("idle")
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
        {/* Ticker with typeahead */}
        <div className="col-span-2 md:col-span-1" ref={dropdownRef}>
          <label className={labelClass}>Ticker</label>
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                set("ticker", "")
                setExpiries([])
                setExpiryStatus("idle")
              }}
              onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
              required
              placeholder="Search ticker…"
              autoComplete="off"
              className={inputClass + " uppercase pr-8"}
            />
            {/* Status icon */}
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
              {expiryStatus === "loading" && (
                <span className="w-3.5 h-3.5 border-2 border-gray-500 border-t-indigo-400 rounded-full animate-spin block" />
              )}
              {expiryStatus === "done" && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5 text-emerald-400">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              )}
              {expiryStatus === "error" && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5 text-rose-400">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </div>

            {/* Dropdown */}
            {showDropdown && suggestions.length > 0 && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#1a1a2e] border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden">
                {suggestions.map((s) => (
                  <button
                    key={s.symbol}
                    type="button"
                    onMouseDown={() => selectTicker(s.symbol)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/8 transition text-left"
                  >
                    <span className="font-mono font-semibold text-xs text-white w-14 shrink-0">{s.symbol}</span>
                    <span className="text-xs text-gray-500 truncate">{s.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {expiryStatus === "done" && expiries.length > 0 && (
            <p className="text-xs text-gray-600 mt-1">{expiries.length} expiry dates available</p>
          )}
          {expiryStatus === "error" && (
            <p className="text-xs text-rose-400 mt-1">No options found for this ticker</p>
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
              className={inputClass + ""}
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
              className={inputClass + ""}
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
              className={inputClass + ""}
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
              className={inputClass + ""}
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
        disabled={expiryStatus === "loading" || expiryStatus === "error" || !leg.ticker}
        className="mt-5 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl transition shadow-lg shadow-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        + Add leg
      </button>
    </form>
  )
}
