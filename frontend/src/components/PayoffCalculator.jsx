const fmt = (n) => (n == null ? "—" : `$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`)

export default function PayoffCalculator({ horizon, strategyName, ticker }) {
  if (!horizon) return null

  const { payoff_at, net_cost_dollars, breakevens, max_profit, max_loss, max_roi, dte, expiry, legs } = horizon

  const entries = Object.entries(payoff_at)
    .map(([price, pnl]) => [parseFloat(price), pnl])
    .sort((a, b) => a[0] - b[0])

  const maxAbs = Math.max(...entries.map(([, pnl]) => Math.abs(pnl)), 1)

  return (
    <div className="bg-white/[0.02] border border-white/8 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-white">
              Payoff at expiry — {strategyName} on {ticker}
            </h2>
            <p className="text-xs text-gray-600 mt-0.5">
              {expiry} · {dte} days of runway · {legs?.length} leg{legs?.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 divide-x divide-white/5 border-b border-white/5">
        <div className="px-6 py-4">
          <p className="text-xs text-gray-600 mb-1">Max Loss</p>
          <p className="text-lg font-bold text-rose-400">−{fmt(Math.abs(max_loss ?? net_cost_dollars))}</p>
          <p className="text-xs text-gray-700 mt-0.5">worst case at expiry</p>
        </div>
        <div className="px-6 py-4">
          <p className="text-xs text-gray-600 mb-1">Breakeven{breakevens?.length > 1 ? "s" : ""}</p>
          {breakevens?.length ? (
            breakevens.map((b, i) => (
              <p key={i} className="text-lg font-bold text-white">${b.toLocaleString()}</p>
            ))
          ) : (
            <p className="text-lg font-bold text-gray-500">—</p>
          )}
          <p className="text-xs text-gray-700 mt-0.5">stock price needed to recover cost</p>
        </div>
        <div className="px-6 py-4">
          <p className="text-xs text-gray-600 mb-1">Max Profit</p>
          <p className="text-lg font-bold text-emerald-400">+{fmt(max_profit)}</p>
          {max_roi != null && (
            <p className="text-xs text-gray-700 mt-0.5">{max_roi.toFixed(0)}% return on cost</p>
          )}
        </div>
      </div>

      {/* P&L table with bar visualization */}
      <div className="px-6 py-4">
        <h3 className="text-xs font-medium text-gray-600 uppercase tracking-wider mb-3">P&L at expiry by stock price</h3>
        <div className="flex flex-col gap-1.5">
          {entries.map(([price, pnl], i) => {
            const isBreakeven = breakevens?.some((b) => Math.abs(b - price) < (entries[1]?.[0] - entries[0]?.[0]) * 0.6)
            const barWidth = Math.abs(pnl) / maxAbs
            const isProfit = pnl > 0
            const isLoss = pnl < 0

            return (
              <div key={i} className={`flex items-center gap-3 py-1.5 px-2 rounded-lg transition ${isBreakeven ? "bg-white/[0.04] border border-white/8" : ""}`}>
                <span className="w-20 text-xs text-gray-500 text-right font-mono shrink-0">
                  ${price.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </span>

                {/* Bar */}
                <div className="flex-1 flex items-center gap-1 h-5">
                  {isProfit ? (
                    <div className="flex-1 flex items-center">
                      <div className="w-1/2" />
                      <div
                        className="h-3.5 rounded-r-sm bg-emerald-500/50 transition-all"
                        style={{ width: `${barWidth * 50}%` }}
                      />
                    </div>
                  ) : isLoss ? (
                    <div className="flex-1 flex items-center justify-end">
                      <div
                        className="h-3.5 rounded-l-sm bg-rose-500/40 transition-all"
                        style={{ width: `${barWidth * 50}%` }}
                      />
                      <div className="w-1/2" />
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center">
                      <div className="w-1/2 border-r border-white/20 h-3.5" />
                    </div>
                  )}
                </div>

                <span className={`w-24 text-right text-xs font-medium shrink-0 ${isProfit ? "text-emerald-400" : isLoss ? "text-rose-400" : "text-gray-400"}`}>
                  {pnl >= 0 ? "+" : "−"}{fmt(Math.abs(pnl))}
                </span>

                {isBreakeven && (
                  <span className="text-[10px] font-semibold text-white/50 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 shrink-0">
                    breakeven
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="px-6 py-3 border-t border-white/5 text-xs text-gray-700">
        P&L shown per contract (100 shares). Assumes held to expiry. Does not account for early exercise or dividends.
      </div>
    </div>
  )
}
