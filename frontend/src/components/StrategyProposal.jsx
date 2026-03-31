import { useState } from "react"

const STRATEGY_COLORS = {
  "Bull Call Spread": "emerald",
  "Long Call": "emerald",
  "Bear Put Spread": "rose",
  "Long Put": "rose",
  "Long Straddle": "violet",
  "Long Strangle": "violet",
  "Iron Condor": "amber",
}

const colorClasses = {
  emerald: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  rose: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  violet: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  amber: "bg-amber-500/15 text-amber-400 border-amber-500/30",
}

export default function StrategyProposal({ proposal, onConfirm, onEditManually, onReset, loading }) {
  const [qtys, setQtys] = useState(proposal.legs.map(() => 1))

  const updateQty = (i, delta) => {
    setQtys((prev) => prev.map((q, idx) => idx === i ? Math.max(1, Math.min(10, q + delta)) : q))
  }

  const handleConfirm = () => {
    onConfirm(proposal.legs.map((leg, i) => ({ ...leg, qty: qtys[i] })))
  }

  const color = STRATEGY_COLORS[proposal.strategy_name] || "indigo"
  const colorClass = colorClasses[color] || "bg-indigo-500/15 text-indigo-400 border-indigo-500/30"

  return (
    <div className="bg-white/[0.02] border border-white/8 rounded-2xl p-6 flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${colorClass}`}>
              {proposal.strategy_name}
            </span>
            <span className="text-xs text-gray-500 font-mono font-semibold">{proposal.ticker}</span>
            {proposal.same_expiry && (
              <span className="text-xs text-gray-700 bg-white/[0.03] border border-white/8 rounded-full px-2 py-0.5">
                same expiry
              </span>
            )}
          </div>
          <p className="text-sm text-gray-400 leading-relaxed max-w-2xl">
            {proposal.description}
          </p>
        </div>
        <button
          onClick={onReset}
          className="text-xs text-gray-600 hover:text-gray-400 transition shrink-0 mt-0.5 whitespace-nowrap"
        >
          ← Start over
        </button>
      </div>

      {/* Visual Chart */}
      {(() => {
        const currentPrice = proposal.current_price;
        const allStrikes = proposal.legs.map(l => l.strike_hint).filter(s => s != null);
        const hasPricing = currentPrice != null || allStrikes.length > 0;
        
        if (!hasPricing) return null;

        let minPrice = 0, maxPrice = 100, span = 100;
        const prices = [...allStrikes];
        if (currentPrice != null) prices.push(currentPrice);
        
        if (prices.length > 0) {
            minPrice = Math.min(...prices);
            maxPrice = Math.max(...prices);
            
            // Add padding so dots don't clip edges
            const padding = (maxPrice - minPrice) * 0.1 || minPrice * 0.1 || 10;
            minPrice = Math.max(0, minPrice - padding);
            maxPrice = maxPrice + padding;
            span = maxPrice - minPrice;
        }

        const getPercent = (price) => ((price - minPrice) / span) * 100;

        return (
          <div className="flex flex-col gap-3 py-2">
            <h3 className="text-xs font-medium text-gray-600 uppercase tracking-wider">Strategy Map</h3>
            <div className="relative w-full h-12 mt-2">
              {/* The Track */}
              <div className="absolute top-1/2 left-0 right-0 h-1 bg-white/[0.05] rounded-full -translate-y-1/2" />
              
              {/* Current Price Marker */}
              {currentPrice != null && (
                <div 
                  className="absolute top-1/2 w-3 h-3 bg-white border border-white/50 rounded-full -translate-x-1/2 -translate-y-1/2 shadow-[0_0_10px_rgba(255,255,255,0.4)] z-10"
                  style={{ left: `${getPercent(currentPrice)}%` }}
                >
                  <div className="absolute -top-7 left-1/2 -translate-x-1/2 text-[10px] font-bold text-white whitespace-nowrap bg-black/60 backdrop-blur-md px-1.5 py-0.5 rounded border border-white/10">
                    Current: ${currentPrice.toFixed(2)}
                  </div>
                </div>
              )}
              
              {/* Strike Markers */}
              {proposal.legs.map((leg, i) => {
                if (leg.strike_hint == null) return null;
                
                const isBuy = leg.side === "buy";
                
                let ringColor = isBuy ? "border-emerald-500/60" : "border-rose-500/60";
                let shadow = isBuy ? "shadow-[0_0_8px_rgba(16,185,129,0.3)]" : "shadow-[0_0_8px_rgba(244,63,94,0.3)]";
                let bgColor = isBuy ? "bg-emerald-500 text-white" : "bg-rose-500 text-white";

                return (
                  <div 
                    key={`strike-${i}`}
                    className={`absolute top-1/2 w-[18px] h-[18px] border-[2.5px] rounded-full -translate-x-1/2 -translate-y-1/2 ${ringColor} ${bgColor} ${shadow} z-20 cursor-pointer hover:scale-125 transition-transform`}
                    style={{ left: `${getPercent(leg.strike_hint)}%` }}
                  >
                    <div className={`absolute -bottom-7 left-1/2 -translate-x-1/2 text-[10px] font-semibold whitespace-nowrap px-1.5 py-0.5 rounded border border-white/5 bg-black/60 backdrop-blur-md ${isBuy ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {leg.side} {leg.option_type}: ${leg.strike_hint}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* Proposed legs */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-gray-600 uppercase tracking-wider">Proposed legs</h3>
          <p className="text-xs text-gray-700">Adjust qty to express conviction</p>
        </div>

        {proposal.legs.map((leg, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-4 py-3 bg-white/[0.03] border border-white/8 rounded-xl flex-wrap"
          >
            <span className="w-5 h-5 bg-indigo-500/15 text-indigo-400 text-xs font-bold rounded-full flex items-center justify-center border border-indigo-500/20 shrink-0">
              {i + 1}
            </span>
            <span className="font-mono font-semibold text-xs text-white">{proposal.ticker}</span>
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize border ${
                leg.option_type === "call"
                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
                  : "bg-rose-500/15 text-rose-400 border-rose-500/20"
              }`}
            >
              {leg.option_type}
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize border ${
                leg.side === "buy"
                  ? "bg-sky-500/15 text-sky-400 border-sky-500/20"
                  : "bg-amber-500/15 text-amber-400 border-amber-500/20"
              }`}
            >
              {leg.side}
            </span>
            {leg.strike_hint != null && (
              <span className="text-xs text-gray-500">
                strike ~<span className="text-gray-300 font-medium">${leg.strike_hint.toLocaleString()}</span>
              </span>
            )}
            <span className="text-xs text-gray-600">by {leg.expiry_to}</span>

            {/* Qty control */}
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-xs text-gray-600">qty</span>
              <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => updateQty(i, -1)}
                  disabled={qtys[i] <= 1}
                  className="w-5 h-5 flex items-center justify-center text-gray-500 hover:text-white transition disabled:opacity-30 rounded text-sm leading-none"
                >
                  −
                </button>
                <span className="w-5 text-center text-xs font-semibold text-white">{qtys[i]}</span>
                <button
                  type="button"
                  onClick={() => updateQty(i, 1)}
                  disabled={qtys[i] >= 10}
                  className="w-5 h-5 flex items-center justify-center text-gray-500 hover:text-white transition disabled:opacity-30 rounded text-sm leading-none"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        ))}

        {/* Ratio hint */}
        {qtys.some((q, i) => q !== qtys[0]) && (
          <p className="text-xs text-indigo-400/70 pl-1">
            Custom ratio: {proposal.legs.map((l, i) => `${qtys[i]}× ${l.side} ${l.option_type}`).join(", ")}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleConfirm}
          disabled={loading}
          className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl transition disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg shadow-indigo-500/20"
        >
          {loading && (
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          )}
          {loading ? "Searching…" : "Compare across time horizons →"}
        </button>
        <button
          onClick={onEditManually}
          className="text-sm text-gray-500 hover:text-gray-300 border border-white/10 hover:border-white/20 px-4 py-2.5 rounded-xl transition"
        >
          Edit manually
        </button>
      </div>
    </div>
  )
}
