const fmt = (n, dec = 2) =>
  n == null ? "—" : typeof n === "number" ? `$${n.toFixed(dec)}` : n

const fmtNum = (n) => (n == null ? "—" : Number(n).toLocaleString())

const fmtPct = (n) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`)

export default function ResultsTable({ results, sortBy }) {
  if (!results) return null

  const { legs, net_debit, total_ask, total_mid } = results

  return (
    <div className="bg-white/[0.02] border border-white/8 rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">Results</h2>
          <p className="text-xs text-gray-600 mt-0.5">
            Cheapest contract per leg · sorted by{" "}
            <span className="text-gray-400 font-medium">{sortBy}</span> price
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
              {["Leg", "Ticker", "Type", "Side", "Contract", "Expiry", "Strike", "Bid", "Ask", "Mid", "Spread", "Volume", "OI", "IV"].map((h, i) => (
                <th
                  key={h}
                  className={`px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wider whitespace-nowrap ${
                    i <= 4 ? "text-left" : "text-right"
                  } ${h === "Ask" ? "text-indigo-400" : ""}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {legs.map((leg, i) => (
              <tr
                key={i}
                className="border-b border-white/[0.04] hover:bg-white/[0.02] transition"
              >
                <td className="px-4 py-3 text-gray-600 text-xs">{leg.leg_index + 1}</td>
                <td className="px-4 py-3 font-semibold text-white font-mono text-xs">{leg.ticker}</td>
                <td className="px-4 py-3">
                  {leg.error ? (
                    <span className="text-xs text-rose-400">No match</span>
                  ) : (
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                        leg.option_type === "call"
                          ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                          : "bg-rose-500/15 text-rose-400 border border-rose-500/20"
                      }`}
                    >
                      {leg.option_type}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {!leg.error && (
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                        leg.side === "buy"
                          ? "bg-sky-500/15 text-sky-400 border border-sky-500/20"
                          : "bg-amber-500/15 text-amber-400 border border-amber-500/20"
                      }`}
                    >
                      {leg.side}
                    </span>
                  )}
                </td>
                {leg.error ? (
                  <td colSpan={10} className="px-4 py-3 text-xs text-gray-600 italic">
                    {leg.error}
                  </td>
                ) : (
                  <>
                    <td className="px-4 py-3 text-xs text-gray-500 font-mono">{leg.contractSymbol}</td>
                    <td className="px-4 py-3 text-right text-gray-400 text-xs">{leg.expiration}</td>
                    <td className="px-4 py-3 text-right text-gray-400 text-xs">{fmt(leg.strike)}</td>
                    <td className="px-4 py-3 text-right text-gray-500 text-xs">{fmt(leg.bid)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-indigo-400 text-xs">{fmt(leg.ask)}</td>
                    <td className="px-4 py-3 text-right text-gray-400 text-xs">{fmt(leg.mid)}</td>
                    <td className="px-4 py-3 text-right text-gray-500 text-xs">{fmt(leg.spread)}</td>
                    <td className="px-4 py-3 text-right text-gray-500 text-xs">{fmtNum(leg.volume)}</td>
                    <td className="px-4 py-3 text-right text-gray-500 text-xs">{fmtNum(leg.openInterest)}</td>
                    <td className="px-4 py-3 text-right text-gray-500 text-xs">{fmtPct(leg.impliedVolatility)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-white/10 bg-indigo-500/5">
              <td colSpan={8} className="px-4 py-3 text-xs font-semibold text-gray-400">
                Net debit
                <span className="ml-1.5 text-gray-600 font-normal">(buys − sells, ask prices)</span>
              </td>
              <td className="px-4 py-3 text-right font-bold text-indigo-400 text-sm">
                {net_debit != null ? (
                  <span className={net_debit >= 0 ? "text-indigo-400" : "text-emerald-400"}>
                    {net_debit >= 0 ? fmt(net_debit) : `-${fmt(Math.abs(net_debit))}`}
                  </span>
                ) : "—"}
              </td>
              <td colSpan={5} />
            </tr>
            <tr className="bg-white/[0.01]">
              <td colSpan={8} className="px-4 py-2 text-xs text-gray-600">
                Total buy ask · Total sell bid · Total mid
              </td>
              <td className="px-4 py-2 text-right text-xs text-gray-500">
                {fmt(total_ask)} · {fmt(results.total_sell_bid)} · {fmt(total_mid)}
              </td>
              <td colSpan={5} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
