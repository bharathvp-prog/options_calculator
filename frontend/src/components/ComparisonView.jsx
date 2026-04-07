const fmt = (n, dec = 2) => (n == null ? "—" : `$${Number(n).toFixed(dec)}`)
const fmtPct = (n) => (n == null ? "—" : `${n.toFixed(1)}%`)

export default function ComparisonView({ data, onSelectHorizon, selectedExpiry, onViewPayoff }) {
  if (!data?.horizons?.length) return null

  const skippedReasons = data.skipped?.length
    ? [...new Set(data.skipped.map((s) => s.reason))]
    : []

  const selectedHorizon = data.horizons.find(h => h.expiry === selectedExpiry)

  return (
    <div className="bg-white/[0.02] border border-white/8 rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">Expiry comparison — {data.ticker}</h2>
          <p className="text-xs text-gray-600 mt-0.5">
            Best contract per leg at each horizon · click a row to inspect leg details
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-gray-500">Live data</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5">
              {["Horizon", "Expiry", "DTE", "Net Cost", "$/day", "Max Profit", "Max ROI", "Breakeven(s)", "Contracts"].map((h, i) => (
                <th
                  key={h}
                  className={`px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wider whitespace-nowrap ${
                    i <= 1 ? "text-left" : "text-right"
                  } ${h === "$/day" ? "text-indigo-400/80" : ""}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.horizons.map((h) => {
              const isSelected = selectedExpiry === h.expiry
              const isBest = h.best_value

              return (
                <tr
                  key={h.expiry}
                  onClick={() => onSelectHorizon(isSelected ? null : h)}
                  className={`border-b border-white/[0.04] cursor-pointer transition ${
                    isSelected
                      ? "bg-indigo-500/10 border-b-indigo-500/20"
                      : isBest
                      ? "bg-emerald-500/[0.04] hover:bg-white/[0.03]"
                      : "hover:bg-white/[0.02]"
                  }`}
                >
                  <td className="px-4 py-3 text-left">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${isSelected ? "text-indigo-300" : "text-gray-300"}`}>
                        {h.label}
                      </span>
                      {isBest && !isSelected && (
                        <span className="text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 rounded-full px-1.5 py-0.5">
                          best value
                        </span>
                      )}
                      {isSelected && (
                        <span className="text-[10px] font-semibold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 rounded-full px-1.5 py-0.5">
                          selected
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 text-left">{h.expiry}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-xs font-medium ${h.dte > 90 ? "text-emerald-400" : h.dte > 30 ? "text-amber-400" : "text-rose-400"}`}>
                      {h.dte}d
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-white font-medium">{fmt(h.net_cost_dollars)}</td>
                  <td className="px-4 py-3 text-right text-xs font-semibold text-indigo-400">
                    {h.cost_per_day != null ? `$${h.cost_per_day.toFixed(2)}/d` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-emerald-400">{fmt(h.max_profit)}</td>
                  <td className="px-4 py-3 text-right text-xs text-gray-400">{fmtPct(h.max_roi)}</td>
                  <td className="px-4 py-3 text-right text-xs text-gray-500">
                    {h.breakevens?.length ? h.breakevens.map((b) => `$${b}`).join(", ") : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex flex-col gap-0.5 items-end">
                      {h.legs.map((l, i) => (
                        <span key={i} className="text-[10px] text-gray-600 font-mono">
                          {l.qty > 1 ? `${l.qty}× ` : ""}{l.contractSymbol?.slice(-15) || `$${l.strike} ${l.option_type}`}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Leg Detail Focus Panel */}
      {selectedHorizon && (
        <div className="border-t border-indigo-500/20 bg-indigo-500/[0.04] px-6 py-5 animate-[fadeSlide_0.2s_ease-out]">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">
              Leg breakdown — {selectedHorizon.label} ({selectedHorizon.expiry})
            </h3>
            <button
              onClick={(e) => { e.stopPropagation(); onViewPayoff(selectedHorizon) }}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition flex items-center gap-2 shadow-lg shadow-indigo-500/20"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h4l3 8 4-16 3 8h4" />
              </svg>
              View P/L
            </button>
          </div>

          <div className="bg-black/20 border border-white/5 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/5">
                  {["#", "Contract", "Type", "Side", "Strike", "Bid", "Ask", "Mid", "LTP", "Qty", "Cost"].map((col) => (
                    <th key={col} className="px-3 py-2.5 text-gray-500 font-medium uppercase tracking-wider text-right first:text-left">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selectedHorizon.legs.map((leg, i) => {
                  const isBuy = leg.side === "buy"
                  const usedLtp = isBuy ? leg.ask <= 0 : leg.bid <= 0
                  const rawPrice = isBuy
                    ? (leg.ask > 0 ? leg.ask : (leg.lastPrice || 0))
                    : (leg.bid > 0 ? leg.bid : (leg.lastPrice || 0))
                  const perContract = isBuy ? -rawPrice : rawPrice
                  const totalCost = perContract * (leg.qty || 1) * 100

                  return (
                    <tr key={i} className="border-b border-white/[0.03] last:border-b-0">
                      <td className="px-3 py-2.5 text-left">
                        <span className="w-5 h-5 inline-flex items-center justify-center bg-indigo-500/15 text-indigo-400 text-[10px] font-bold rounded-full border border-indigo-500/20">
                          {i + 1}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-400 font-mono">{leg.contractSymbol?.slice(-15) || "—"}</td>
                      <td className="px-3 py-2.5 text-right">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize ${
                          leg.option_type === "call"
                            ? "bg-emerald-500/15 text-emerald-400"
                            : "bg-rose-500/15 text-rose-400"
                        }`}>
                          {leg.option_type}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize ${
                          isBuy
                            ? "bg-emerald-500/15 text-emerald-400"
                            : "bg-rose-500/15 text-rose-400"
                        }`}>
                          {leg.side}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-white font-medium">${leg.strike}</td>
                      <td className="px-3 py-2.5 text-right text-gray-400">{fmt(leg.bid)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-400">{fmt(leg.ask)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-300 font-medium">{fmt(leg.mid)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-400">{fmt(leg.lastPrice)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-400">{leg.qty || 1}</td>
                      <td className={`px-3 py-2.5 text-right font-semibold ${totalCost >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {totalCost >= 0 ? "+" : "−"}${Math.abs(totalCost).toFixed(0)}
                        {usedLtp && <span className="ml-1 text-[9px] text-amber-500/70 font-normal">LTP</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-white/10 bg-white/[0.02]">
                  <td colSpan={10} className="px-3 py-3 text-right text-xs text-gray-400 font-medium uppercase tracking-wider">
                    Net cost
                  </td>
                  <td className={`px-3 py-3 text-right text-sm font-bold ${
                    selectedHorizon.net_cost_dollars <= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}>
                    {selectedHorizon.net_cost_dollars <= 0 ? "+" : "−"}${Math.abs(selectedHorizon.net_cost_dollars).toFixed(0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <div className="px-6 py-3 border-t border-white/5 flex items-center gap-4 text-xs text-gray-700">
        <span><span className="text-indigo-400 font-medium">$/day</span> = net cost ÷ DTE — lower means more time value per dollar</span>
        <span className="text-gray-800">·</span>
        <span><span className="text-rose-400 font-medium">red DTE</span> = under 30 days, unlikely to see target price move</span>
      </div>

      {skippedReasons.length > 0 && (
        <div className="mx-4 mb-4 px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-400">
          <span className="font-semibold">{data.skipped.length} horizon{data.skipped.length !== 1 ? "s" : ""} excluded</span>
          {" — "}{skippedReasons.join("; ")}
        </div>
      )}
    </div>
  )
}
