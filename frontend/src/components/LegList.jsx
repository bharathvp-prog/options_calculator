export default function LegList({ legs, onRemove, sortBy, onSortByChange, sameExpiry, onSameExpiryChange, onSearch, loading }) {
  return (
    <div className="bg-white/[0.02] border border-white/8 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-5 gap-4 flex-wrap">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <span className="w-5 h-5 rounded-md bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 text-indigo-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            </svg>
          </span>
          Strategy legs
          <span className="text-xs font-normal text-gray-600">({legs.length})</span>
        </h2>

        <div className="flex items-center gap-4 flex-wrap">
          {/* Same expiry toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <button
              type="button"
              role="switch"
              aria-checked={sameExpiry}
              onClick={() => onSameExpiryChange(!sameExpiry)}
              className={`relative w-9 h-5 rounded-full transition-colors ${sameExpiry ? "bg-indigo-600" : "bg-white/10"}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${sameExpiry ? "translate-x-4" : "translate-x-0"}`}
              />
            </button>
            <span className="text-xs font-medium text-gray-400">Same expiry</span>
          </label>

          {/* Sort by */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500">Sort by</label>
            <select
              value={sortBy}
              onChange={(e) => onSortByChange(e.target.value)}
              className="text-sm bg-white/5 border border-white/10 text-gray-300 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition"
            >
              <option value="ask">Ask price</option>
              <option value="mid">Mid price</option>
              <option value="spread">Spread</option>
            </select>
          </div>
        </div>
      </div>

      {legs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center border border-dashed border-white/8 rounded-xl">
          <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center mb-3">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-gray-600">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </div>
          <p className="text-sm text-gray-500">No legs added yet</p>
          <p className="text-xs text-gray-700 mt-0.5">Use the form above to add your first leg</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 mb-5">
          {legs.map((leg, i) => (
            <div
              key={i}
              className="flex items-center justify-between px-4 py-3 bg-white/[0.03] border border-white/8 rounded-xl text-sm group hover:border-white/12 transition"
            >
              <div className="flex items-center gap-3 flex-wrap">
                <span className="w-5 h-5 bg-indigo-500/15 text-indigo-400 text-xs font-bold rounded-full flex items-center justify-center border border-indigo-500/20">
                  {i + 1}
                </span>
                <span className="font-semibold text-white font-mono text-xs">{leg.ticker}</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                    leg.option_type === "call"
                      ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                      : "bg-rose-500/15 text-rose-400 border border-rose-500/20"
                  }`}
                >
                  {leg.option_type}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                    leg.side === "buy"
                      ? "bg-sky-500/15 text-sky-400 border border-sky-500/20"
                      : "bg-amber-500/15 text-amber-400 border border-amber-500/20"
                  }`}
                >
                  {leg.side}
                </span>
                <span className="text-gray-500 text-xs">
                  {leg.expiry_from} → {leg.expiry_to}
                </span>
                {(leg.strike_min || leg.strike_max) && (
                  <span className="text-gray-600 text-xs">
                    ${leg.strike_min ?? "any"} – ${leg.strike_max ?? "any"}
                  </span>
                )}
              </div>
              <button
                onClick={() => onRemove(i)}
                className="text-gray-700 hover:text-rose-400 transition text-xs ml-4 opacity-0 group-hover:opacity-100"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={onSearch}
        disabled={legs.length === 0 || loading}
        className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl transition disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg shadow-indigo-500/20"
      >
        {loading && (
          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        )}
        {loading ? "Searching…" : "Find Cheapest"}
      </button>
    </div>
  )
}
