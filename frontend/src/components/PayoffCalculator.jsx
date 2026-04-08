import ReactECharts from "echarts-for-react"

const fmt = (n) => (n == null ? "—" : `$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`)

export default function PayoffCalculator({ horizon, strategyName, ticker }) {
  if (!horizon) return null

  const { payoff_at, net_cost_dollars, breakevens, max_profit, max_loss, max_roi, dte, expiry, legs } = horizon

  const entries = Object.entries(payoff_at)
    .map(([price, pnl]) => [parseFloat(price), pnl])
    .sort((a, b) => a[0] - b[0])

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

      {/* P&L chart */}
      {(() => {
        const stride = entries[1]?.[0] - entries[0]?.[0]
        const breakevenSet = new Set(
          breakevens?.flatMap(b =>
            entries
              .filter(([price]) => Math.abs(b - price) < (stride ?? 1) * 0.6)
              .map(([price]) => price)
          ) ?? []
        )
        const chartOption = {
          backgroundColor: "transparent",
          grid: { top: 8, right: 90, bottom: 8, left: 8, containLabel: true },
          xAxis: {
            type: "value",
            axisLabel: {
              color: "rgba(156,163,175,0.7)",
              fontSize: 10,
              formatter: v => v === 0 ? "$0" : `${v > 0 ? "+" : "−"}$${Math.abs(v).toLocaleString()}`,
            },
            splitLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } },
            axisLine: { lineStyle: { color: "rgba(255,255,255,0.1)" } },
          },
          yAxis: {
            type: "category",
            data: entries.map(([price]) => `$${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`),
            axisLabel: { color: "rgba(156,163,175,0.7)", fontSize: 10 },
            axisLine: { show: false },
            axisTick: { show: false },
          },
          tooltip: {
            trigger: "item",
            backgroundColor: "#1a1a2e",
            borderColor: "rgba(255,255,255,0.1)",
            textStyle: { color: "#e5e7eb", fontSize: 12 },
            formatter: params => {
              const [price, pnl] = entries[params.dataIndex]
              const isBreak = breakevenSet.has(price)
              return `<b>Stock @ $${price.toLocaleString()}</b><br/>P&amp;L: ${pnl >= 0 ? "+" : ""}$${pnl.toLocaleString()}${isBreak ? "<br/><i style='color:rgba(255,255,255,0.5)'>~breakeven</i>" : ""}`
            },
          },
          series: [{
            type: "bar",
            data: entries.map(([price, pnl]) => ({
              value: pnl,
              itemStyle: {
                color: pnl > 0 ? "rgba(52,211,153,0.65)" : pnl < 0 ? "rgba(251,113,133,0.55)" : "rgba(156,163,175,0.4)",
                borderRadius: pnl >= 0 ? [0, 3, 3, 0] : [3, 0, 0, 3],
                borderColor: breakevenSet.has(price) ? "rgba(255,255,255,0.3)" : "transparent",
                borderWidth: breakevenSet.has(price) ? 1 : 0,
              },
            })),
            label: {
              show: true,
              position: "right",
              formatter: params => {
                const pnl = entries[params.dataIndex][1]
                return `${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toLocaleString()}`
              },
              color: params => entries[params.dataIndex][1] >= 0 ? "#34d399" : "#fb7185",
              fontSize: 10,
            },
          }],
        }
        const chartHeight = Math.max(240, entries.length * 30)
        return (
          <div className="px-6 py-4">
            <h3 className="text-xs font-medium text-gray-600 uppercase tracking-wider mb-3">P&L at expiry by stock price</h3>
            <ReactECharts option={chartOption} style={{ height: chartHeight }} opts={{ renderer: "svg" }} />
          </div>
        )
      })()}

      <div className="px-6 py-3 border-t border-white/5 text-xs text-gray-700">
        P&L shown per contract (100 shares). Assumes held to expiry. Does not account for early exercise or dividends.
      </div>
    </div>
  )
}
