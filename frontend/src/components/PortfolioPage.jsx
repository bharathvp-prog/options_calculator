import { useState, useEffect, useRef } from "react"
import { auth } from "../firebase"
import { getCashForDate } from "./CashPage"
import ReactECharts from "echarts-for-react"

async function getToken() {
  try {
    return await auth.currentUser?.getIdToken()
  } catch {
    return null
  }
}

const GROUP_ORDER = ["Stock Option", "Stock"]

function fmt(val, decimals = 2) {
  if (val === null || val === undefined) return "—"
  return Number(val).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function pnlColor(val) {
  if (val === null || val === undefined) return "text-gray-400"
  return val >= 0 ? "text-emerald-400" : "text-rose-400"
}

function LsBadge({ value }) {
  const isLong = value === "Long"
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${
      isLong
        ? "bg-sky-500/15 text-sky-400 border-sky-500/20"
        : "bg-amber-500/15 text-amber-400 border-amber-500/20"
    }`}>
      {value}
    </span>
  )
}

function CpBadge({ value }) {
  if (!value) return null
  const isCall = value === "Call"
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${
      isCall
        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
        : "bg-rose-500/15 text-rose-400 border-rose-500/20"
    }`}>
      {value}
    </span>
  )
}

// ECharts stacked area chart: cash (indigo band) + securities (emerald/rose band)
// cashSeries: per-date cash values (same length as values/dates), handles step changes
function PortfolioChart({ dates, values, cashSeries, height = 220 }) {
  if (!dates || dates.length < 2) return null
  const cs = cashSeries && cashSeries.length === values.length ? cashSeries : values.map(() => 0)
  const hasCash = cs.some(v => v > 0)
  const totalValues = values.map((v, i) => v + cs[i])
  const positive = totalValues[totalValues.length - 1] >= totalValues[0]
  const secColor = positive ? "#34d399" : "#fb7185"
  const cashColor = "#818cf8"

  const fmtSgd = n => `S$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`

  // Dynamic Y range: pad 5% above/below the total series min/max
  const allTotals = totalValues.filter(v => v != null && v > 0)
  const yMin = allTotals.length ? Math.min(...allTotals) : 0
  const yMax = allTotals.length ? Math.max(...allTotals) : 1
  const yPad = (yMax - yMin) * 0.08 || yMax * 0.05
  const yAxisMin = Math.max(0, yMin - yPad)
  const yAxisMax = yMax + yPad

  const option = {
    backgroundColor: "transparent",
    grid: { top: 8, right: 8, bottom: 8, left: 8, containLabel: false },
    xAxis: {
      type: "category",
      data: dates.map(d => d.slice(5)),
      axisLabel: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      boundaryGap: false,
    },
    yAxis: {
      type: "value",
      min: yAxisMin,
      max: yAxisMax,
      axisLabel: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: "#1a1a2e",
      borderColor: "rgba(255,255,255,0.1)",
      textStyle: { color: "#e5e7eb", fontSize: 12 },
      formatter: params => {
        const idx = params[0].dataIndex
        const date = dates[idx]
        const cashVal = cs[idx]
        const secVal = values[idx]
        const total = cashVal + secVal
        let s = `<div style="font-weight:600;margin-bottom:6px">${date}</div>`
        s += `<div>Securities: ${fmtSgd(secVal)}</div>`
        if (hasCash) s += `<div>Cash: ${fmtSgd(cashVal)}</div>`
        s += `<div style="font-weight:600;margin-top:4px">Total: ${fmtSgd(total)}</div>`
        return s
      },
    },
    dataZoom: [{ type: "inside", start: 0, end: 100 }],
    series: [
      ...(hasCash ? [{
        name: "Cash",
        type: "line",
        stack: "total",
        data: cs,
        symbol: "none",
        lineStyle: { color: "#818cf8", width: 1.5, type: "dashed" },
        areaStyle: { color: "rgba(99,102,241,0.35)" },
        itemStyle: { color: cashColor },
        step: "end",
      }] : []),
      {
        name: "Securities",
        type: "line",
        stack: "total",
        data: values,
        symbol: "circle",
        symbolSize: 4,
        lineStyle: { color: secColor, width: 2 },
        areaStyle: { color: positive ? "rgba(52,211,153,0.30)" : "rgba(251,113,133,0.30)" },
        itemStyle: { color: secColor },
      },
    ],
  }

  return (
    <div>
      <ReactECharts option={option} style={{ height }} opts={{ renderer: "svg" }} />
      <div className="flex items-center justify-center gap-5 mt-1">
        <div className="flex items-center gap-2">
          <div className="w-4 h-2.5 rounded-sm" style={{ background: positive ? "rgba(52,211,153,0.50)" : "rgba(251,113,133,0.50)", border: `1.5px solid ${secColor}` }} />
          <span className="text-xs text-gray-400 font-medium">Securities</span>
        </div>
        {hasCash && (
          <div className="flex items-center gap-2">
            <div className="w-4 h-2.5 rounded-sm" style={{ background: "rgba(99,102,241,0.45)", border: "1.5px dashed #818cf8" }} />
            <span className="text-xs text-gray-400 font-medium">Cash</span>
          </div>
        )}
      </div>
    </div>
  )
}

// Compute total portfolio value for each date.
// For both stocks and options we scale market_value_sgd by the movement of the underlying
// stock price. For stocks the reference is the last yfinance close (anchors last column to
// Saxo market value). For options the reference is pos.underlying_price (Saxo's current
// underlying price), which ties the last column to market_value_sgd as well.
function scaledMvForDate(pos, di, dates, prices) {
  const mv = pos.market_value_sgd ?? 0
  const priceSeries = prices[pos.yf_ticker]
  if (!priceSeries || priceSeries.length === 0) return mv
  const refPrice = pos.asset_type === "Stock Option"
    ? pos.underlying_price
    : priceSeries[priceSeries.length - 1]
  if (!refPrice) return mv
  const offset = dates.length - priceSeries.length
  const priceIdx = di - offset
  const historicPrice = priceIdx >= 0 ? priceSeries[priceIdx] : null
  if (historicPrice === null) return mv
  return mv * (historicPrice / refPrice)
}

function computePortfolioTimeSeries(positions, dates, prices) {
  if (!dates || dates.length === 0) return []
  return dates.map((_, di) => {
    const total = positions.reduce((sum, pos) => sum + scaledMvForDate(pos, di, dates, prices), 0)
    return Math.round(total)
  })
}

function PositionDetail({ pos, priceDates, priceMap, pricesLoading }) {
  const isOptions = pos.asset_type === "Stock Option"
  const dates7 = priceDates.slice(-7)
  const values7 = dates7.map((_, di) => {
    const globalDi = priceDates.length - 7 + di
    return scaledMvForDate(pos, globalDi, priceDates, priceMap)
  })
  const hasPrices = dates7.length >= 2 && values7.some(v => v !== (pos.market_value_sgd ?? 0))

  const pnlPct = pos.open_price && pos.current_price
    ? ((pos.current_price - pos.open_price) / Math.abs(pos.open_price)) * 100
    : null

  return (
    <div className="bg-white/[0.025] rounded-xl p-4 mt-1 mb-2 mx-1 flex flex-col sm:flex-row gap-5">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-x-10 gap-y-2.5 text-xs shrink-0">
        <div>
          <p className="text-gray-600 uppercase tracking-wider text-[9px] mb-0.5">Open price</p>
          <p className="text-gray-300 font-medium">{fmt(pos.open_price)}</p>
        </div>
        <div>
          <p className="text-gray-600 uppercase tracking-wider text-[9px] mb-0.5">
            {isOptions ? "Underlying" : "Current price"}
          </p>
          <p className="text-gray-300 font-medium">
            {fmt(isOptions ? pos.underlying_price : pos.current_price)}
          </p>
        </div>
        <div>
          <p className="text-gray-600 uppercase tracking-wider text-[9px] mb-0.5">P&L (SGD)</p>
          <p className={`font-semibold ${pnlColor(pos.pnl_sgd)}`}>
            {pos.pnl_sgd != null ? (pos.pnl_sgd >= 0 ? "+" : "") + fmt(pos.pnl_sgd) : "—"}
            {pnlPct != null && (
              <span className="ml-1.5 font-normal text-[10px] opacity-70">
                ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%)
              </span>
            )}
          </p>
        </div>
        <div>
          <p className="text-gray-600 uppercase tracking-wider text-[9px] mb-0.5">Mkt Val (SGD)</p>
          <p className="text-gray-300 font-medium">{fmt(pos.market_value_sgd)}</p>
        </div>
        {isOptions && (
          <>
            <div>
              <p className="text-gray-600 uppercase tracking-wider text-[9px] mb-0.5">Strike</p>
              <p className="text-gray-300 font-medium">{fmt(pos.strike)}</p>
            </div>
            <div>
              <p className="text-gray-600 uppercase tracking-wider text-[9px] mb-0.5">Expiry</p>
              <p className="text-gray-300 font-medium">{pos.expiry || "—"}</p>
            </div>
          </>
        )}
        <div>
          <p className="text-gray-600 uppercase tracking-wider text-[9px] mb-0.5">Quantity</p>
          <p className="text-gray-300 font-medium">{fmt(pos.quantity, 0)}</p>
        </div>
        {pos.currency && pos.currency !== "SGD" && (
          <div>
            <p className="text-gray-600 uppercase tracking-wider text-[9px] mb-0.5">Currency</p>
            <p className="text-gray-300 font-medium">{pos.currency}</p>
          </div>
        )}
      </div>

      {/* 7-day chart */}
      <div className="flex-1 min-w-0">
        <p className="text-gray-600 uppercase tracking-wider text-[9px] mb-2">
          7-day {isOptions ? "underlying" : "position"} value (SGD)
        </p>
        {pricesLoading ? (
          <div className="h-16 flex items-center justify-center">
            <div className="h-1 w-16 rounded bg-white/10 animate-pulse" />
          </div>
        ) : hasPrices ? (
          <PortfolioChart dates={dates7} values={values7} height={160} />
        ) : (
          <p className="text-xs text-gray-700 py-4">No price history available.</p>
        )}
      </div>
    </div>
  )
}

function GroupTable({ assetType, positions, priceDates, priceMap, pricesLoading, onRequestPrices }) {
  const isOptions = assetType === "Stock Option"
  const totalPnl = positions.reduce((s, p) => s + (p.pnl_sgd ?? 0), 0)
  const totalMv = positions.reduce((s, p) => s + (p.market_value_sgd ?? 0), 0)
  const [expandedIdx, setExpandedIdx] = useState(null)
  const colSpan = isOptions ? 10 : 7

  function handleRowClick(i) {
    const next = expandedIdx === i ? null : i
    setExpandedIdx(next)
    if (next !== null && priceDates.length === 0 && !pricesLoading) {
      onRequestPrices()
    }
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/5 text-gray-600 uppercase tracking-wider text-[10px]">
              <th className="text-left px-5 py-2.5 font-medium">Instrument</th>
              {isOptions && <th className="text-center px-3 py-2.5 font-medium">C/P</th>}
              {isOptions && <th className="text-right px-3 py-2.5 font-medium">Strike</th>}
              {isOptions && <th className="text-left px-3 py-2.5 font-medium">Expiry</th>}
              <th className="text-center px-3 py-2.5 font-medium">L/S</th>
              <th className="text-right px-3 py-2.5 font-medium">Qty</th>
              <th className="text-right px-3 py-2.5 font-medium">Open</th>
              <th className="text-right px-3 py-2.5 font-medium">Current</th>
              <th className="text-right px-3 py-2.5 font-medium">P&L (SGD)</th>
              <th className="text-right px-5 py-2.5 font-medium">Mkt Val (SGD)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.03]">
            {positions.map((p, i) => (
              <>
                <tr
                  key={i}
                  onClick={() => handleRowClick(i)}
                  className={`cursor-pointer transition ${expandedIdx === i ? "bg-white/[0.03]" : "hover:bg-white/[0.02]"}`}
                >
                  <td className="px-5 py-2.5 text-gray-300 max-w-[240px]">
                    <div className="flex items-center gap-1.5">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        className={`w-3 h-3 text-gray-700 shrink-0 transition-transform ${expandedIdx === i ? "rotate-90" : ""}`}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                      <span title={p.instrument} className="truncate block">{p.instrument}</span>
                    </div>
                    {p.currency && p.currency !== "SGD" && (
                      <span className="text-gray-700 text-[9px] ml-4">{p.currency}</span>
                    )}
                  </td>
                  {isOptions && (
                    <td className="px-3 py-2.5 text-center"><CpBadge value={p.call_put} /></td>
                  )}
                  {isOptions && (
                    <td className="px-3 py-2.5 text-right text-gray-400">{fmt(p.strike)}</td>
                  )}
                  {isOptions && (
                    <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{p.expiry || "—"}</td>
                  )}
                  <td className="px-3 py-2.5 text-center"><LsBadge value={p.l_s} /></td>
                  <td className="px-3 py-2.5 text-right text-gray-400">{fmt(p.quantity, 0)}</td>
                  <td className="px-3 py-2.5 text-right text-gray-500">{fmt(p.open_price)}</td>
                  <td className="px-3 py-2.5 text-right text-gray-400">{fmt(p.current_price)}</td>
                  <td className={`px-3 py-2.5 text-right font-medium ${pnlColor(p.pnl_sgd)}`}>
                    {p.pnl_sgd !== null && p.pnl_sgd !== undefined
                      ? (p.pnl_sgd >= 0 ? "+" : "") + fmt(p.pnl_sgd)
                      : "—"}
                  </td>
                  <td className="px-5 py-2.5 text-right text-gray-300">{fmt(p.market_value_sgd)}</td>
                </tr>
                {expandedIdx === i && (
                  <tr key={`${i}-detail`}>
                    <td colSpan={colSpan} className="px-3 py-0 border-b border-white/[0.03]">
                      <PositionDetail
                        pos={p}
                        priceDates={priceDates}
                        priceMap={priceMap}
                        pricesLoading={pricesLoading}
                      />
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-white/15 bg-white/[0.04]">
              <td colSpan={isOptions ? 8 : 5} className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Subtotal
              </td>
              <td className={`px-3 py-3 text-right text-sm font-bold ${pnlColor(totalPnl)}`}>
                {(totalPnl >= 0 ? "+" : "") + fmt(totalPnl)}
              </td>
              <td className="px-5 py-3 text-right text-sm font-bold text-white">
                {fmt(totalMv)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// Trend view: one row per position, columns = dates, value = market value that day
function TrendTable({ assetType, positions, dates, prices, allDates }) {
  const isOptions = assetType === "Stock Option"
  const totalPnl = positions.reduce((s, p) => s + (p.pnl_sgd ?? 0), 0)
  const totalMv = positions.reduce((s, p) => s + (p.market_value_sgd ?? 0), 0)

  function historicMv(pos, di) {
    return scaledMvForDate(pos, di, dates, prices)
  }

  function groupTotalForDate(di) {
    return positions.reduce((sum, pos) => sum + historicMv(pos, di), 0)
  }

  function twoWeekChange(pos) {
    if (!allDates || allDates.length < 2) return null
    const start = scaledMvForDate(pos, 0, allDates, prices)
    const end   = scaledMvForDate(pos, allDates.length - 1, allDates, prices)
    return end - start
  }

  const groupTwoWeekChange = positions.reduce((sum, pos) => sum + (twoWeekChange(pos) ?? 0), 0)

  function dayColor(current, prev) {
    if (prev === null || prev === undefined) return "text-gray-400"
    if (current > prev) return "text-emerald-400"
    if (current < prev) return "text-rose-400"
    return "text-gray-400"
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/5 text-gray-600 uppercase tracking-wider text-[10px]">
              <th className="text-left px-5 py-2.5 font-medium sticky left-0 bg-[#0a0a0f] z-10">Instrument</th>
              {isOptions && <th className="text-center px-3 py-2.5 font-medium">C/P</th>}
              {isOptions && <th className="text-right px-3 py-2.5 font-medium">Strike</th>}
              <th className="text-center px-3 py-2.5 font-medium">L/S</th>
              {dates.map(d => (
                <th key={d} className="text-right px-3 py-2.5 font-medium whitespace-nowrap">{d.slice(5)}</th>
              ))}
              <th className="text-right px-5 py-2.5 font-medium">P&L (SGD)</th>
              <th className="text-right px-5 py-2.5 font-medium">Mkt Val (SGD)</th>
              <th className="text-right px-5 py-2.5 font-medium whitespace-nowrap">2W Chg (SGD)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.03]">
            {positions.map((pos, i) => {
              const chg = twoWeekChange(pos)
              return (
                <tr key={i} className="hover:bg-white/[0.02] transition">
                  <td className="px-5 py-2.5 text-gray-300 max-w-[180px] sticky left-0 bg-[#0a0a0f]">
                    <span title={pos.instrument} className="truncate block">{pos.instrument}</span>
                  </td>
                  {isOptions && (
                    <td className="px-3 py-2.5 text-center"><CpBadge value={pos.call_put} /></td>
                  )}
                  {isOptions && (
                    <td className="px-3 py-2.5 text-right text-gray-400">{fmt(pos.strike)}</td>
                  )}
                  <td className="px-3 py-2.5 text-center"><LsBadge value={pos.l_s} /></td>
                  {dates.map((_, di) => {
                    const cur = historicMv(pos, di)
                    const prev = di > 0 ? historicMv(pos, di - 1) : null
                    return (
                      <td key={di} className={`px-3 py-2.5 text-right whitespace-nowrap ${dayColor(cur, prev)}`}>
                        {fmt(cur, 0)}
                      </td>
                    )
                  })}
                  <td className={`px-3 py-2.5 text-right font-medium ${pnlColor(pos.pnl_sgd)}`}>
                    {pos.pnl_sgd !== null && pos.pnl_sgd !== undefined
                      ? (pos.pnl_sgd >= 0 ? "+" : "") + fmt(pos.pnl_sgd)
                      : "—"}
                  </td>
                  <td className="px-5 py-2.5 text-right text-gray-300">{fmt(pos.market_value_sgd)}</td>
                  <td className={`px-5 py-2.5 text-right font-medium ${chg !== null ? (chg >= 0 ? "text-emerald-400" : "text-rose-400") : "text-gray-600"}`}>
                    {chg !== null ? (chg >= 0 ? "+" : "") + fmt(chg, 0) : "—"}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-white/15 bg-white/[0.04]">
              <td
                colSpan={isOptions ? 4 : 2}
                className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider sticky left-0 bg-[#16161e]"
              >
                Subtotal
              </td>
              {dates.map((_, di) => {
                const cur = groupTotalForDate(di)
                const prev = di > 0 ? groupTotalForDate(di - 1) : null
                return (
                  <td key={di} className={`px-3 py-3 text-right text-sm font-bold whitespace-nowrap ${dayColor(cur, prev)}`}>
                    {fmt(cur, 0)}
                  </td>
                )
              })}
              <td className={`px-3 py-3 text-right text-sm font-bold ${pnlColor(totalPnl)}`}>
                {(totalPnl >= 0 ? "+" : "") + fmt(totalPnl)}
              </td>
              <td className="px-5 py-3 text-right text-sm font-bold text-white">
                {fmt(totalMv)}
              </td>
              <td className={`px-5 py-3 text-right text-sm font-bold ${groupTwoWeekChange >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {(groupTwoWeekChange >= 0 ? "+" : "") + fmt(groupTwoWeekChange, 0)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

function CollapsibleGroup({ group, positions, priceDates, priceMap, pricesLoading, trendDates, showTrend, onRequestPrices }) {
  const [open, setOpen] = useState(true)
  const totalPnl = positions.reduce((s, p) => s + (p.pnl_sgd ?? 0), 0)
  const totalMv = positions.reduce((s, p) => s + (p.market_value_sgd ?? 0), 0)

  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.02] overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-5 py-3 border-b border-white/5 bg-white/[0.02] hover:bg-white/[0.03] transition text-left"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`w-3.5 h-3.5 text-gray-600 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <span className="text-sm font-semibold text-white">{group}</span>
        <span className="text-xs text-gray-600 bg-white/5 border border-white/8 rounded-full px-2 py-0.5">
          {positions.length}
        </span>
        {!open && (
          <span className="ml-auto text-xs text-gray-600">
            MV {(() => {
              if (totalMv >= 1000000) return `$${(totalMv/1000000).toFixed(1)}M`
              if (totalMv >= 1000) return `$${(totalMv/1000).toFixed(0)}k`
              return `$${totalMv.toFixed(0)}`
            })()} · P&L <span className={totalPnl >= 0 ? "text-emerald-500" : "text-rose-500"}>{totalPnl >= 0 ? "+" : ""}{totalPnl >= 1000 || totalPnl <= -1000 ? `$${(totalPnl/1000).toFixed(1)}k` : `$${totalPnl.toFixed(0)}`}</span>
          </span>
        )}
      </button>
      {open && (
        showTrend ? (
          <TrendTable
            assetType={group}
            positions={positions}
            dates={trendDates}
            prices={priceMap}
            allDates={priceDates}
          />
        ) : (
          <GroupTable
            assetType={group}
            positions={positions}
            priceDates={priceDates}
            priceMap={priceMap}
            pricesLoading={pricesLoading}
            onRequestPrices={onRequestPrices}
          />
        )
      )}
    </div>
  )
}

export default function PortfolioPage() {
  const [positions, setPositions] = useState([])
  const [uploadedAt, setUploadedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [error, setError] = useState("")

  const [priceDates, setPriceDates] = useState([])
  const [priceMap, setPriceMap] = useState({})
  const [pricesLoading, setPricesLoading] = useState(false)
  const [cashHistory, setCashHistory] = useState([])
  const [showTrend, setShowTrend] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => { fetchPortfolio() }, [])

  async function fetchPortfolio() {
    setLoading(true)
    try {
      const token = await getToken()
      const headers = token ? { Authorization: `Bearer ${token}` } : {}
      const [res, cashRes] = await Promise.all([
        fetch("/api/portfolio", { headers }),
        fetch("/api/portfolio/cash", { headers }),
      ])
      const data = await res.json()
      setPositions(data.positions || [])
      setUploadedAt(data.uploaded_at || null)
      if (data.price_dates?.length > 0) {
        setPriceDates(data.price_dates)
        setPriceMap(data.price_data || {})
      }
      const cashData = await cashRes.json().catch(() => ({}))
      setCashHistory(cashData.cash_history ?? [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function fetchPrices(days = 14) {
    setPricesLoading(true)
    try {
      const token = await getToken()
      const res = await fetch(`/api/portfolio/prices?days=${days}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const data = await res.json()
      setPriceDates(data.dates || [])
      setPriceMap(data.prices || {})
    } catch {
      // best-effort
    } finally {
      setPricesLoading(false)
    }
  }

  async function refreshPrices() {
    setRefreshing(true)
    setError("")
    try {
      const token = await getToken()
      const res = await fetch("/api/portfolio/refresh", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || "Refresh failed")
      setPositions(data.positions || [])
      setUploadedAt(data.uploaded_at || null)
      setPriceDates(data.price_dates || [])
      setPriceMap(data.price_data || {})
    } catch (e) {
      setError(e.message)
    } finally {
      setRefreshing(false)
    }
  }

  async function handleFile(file) {
    if (!file) return
    if (!file.name.endsWith(".xlsx")) {
      setError("Please upload a .xlsx file exported from Saxo Bank.")
      return
    }
    setError("")
    setUploading(true)
    try {
      const token = await getToken()
      const formData = new FormData()
      formData.append("file", file)
      const res = await fetch("/api/portfolio/upload", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || "Upload failed")
      setUploadModalOpen(false)
      setPriceDates([])
      setPriceMap({})
      await fetchPortfolio()
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  function onDragOver(e) { e.preventDefault(); setDragActive(true) }
  function onDragLeave() { setDragActive(false) }
  function onDrop(e) { e.preventDefault(); setDragActive(false); handleFile(e.dataTransfer.files[0]) }

  const grouped = positions.reduce((acc, pos) => {
    const g = pos.asset_type || "Other"
    if (!acc[g]) acc[g] = []
    acc[g].push(pos)
    return acc
  }, {})
  const orderedGroups = [
    ...GROUP_ORDER.filter(k => grouped[k]),
    ...Object.keys(grouped).filter(k => !GROUP_ORDER.includes(k)),
  ]

  const totalPnl = positions.reduce((s, p) => s + (p.pnl_sgd ?? 0), 0)
  const totalMv = positions.reduce((s, p) => s + (p.market_value_sgd ?? 0), 0)
  const stocksMv = positions.filter(p => p.asset_type === "Stock").reduce((s, p) => s + (p.market_value_sgd ?? 0), 0)
  const derivMv = positions.filter(p => p.asset_type === "Stock Option").reduce((s, p) => s + (p.market_value_sgd ?? 0), 0)
  const today = new Date().toISOString().slice(0, 10)
  const currentCash = getCashForDate(cashHistory, today)
  const accountValue = totalMv + currentCash

  // 14-day portfolio value time series
  const chartValues = computePortfolioTimeSeries(positions, priceDates, priceMap)
  // Per-date cash series for stacked chart
  const chartCashSeries = priceDates.map(d => getCashForDate(cashHistory, d))
  // Use the last 7 dates for trend view
  const trendDates = priceDates.slice(-7)
  const trendOffset = priceDates.length - trendDates.length

  return (
    <main className="max-w-7xl mx-auto px-6 pt-12 pb-16 flex flex-col gap-8">
      {/* Upload modal */}
      {uploadModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setUploadModalOpen(false) }}
        >
          <div className="bg-[#111118] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-base font-semibold text-white">
                  {positions.length === 0 ? "Upload Portfolio" : "Update Portfolio"}
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">Export from Saxo Bank → Positions → Export (.xlsx)</p>
              </div>
              <button
                onClick={() => setUploadModalOpen(false)}
                className="text-gray-600 hover:text-gray-400 transition"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-10 text-center transition cursor-pointer ${
                dragActive
                  ? "border-indigo-500/60 bg-indigo-500/[0.06]"
                  : "border-white/10 bg-white/[0.02] hover:border-white/20"
              }`}
            >
              <div className="flex flex-col items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-indigo-400">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-white mb-1">
                    {uploading ? "Uploading…" : "Drop your .xlsx file here"}
                  </p>
                  <p className="text-xs text-gray-600">or click to choose a file</p>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); fileInputRef.current?.click() }}
                  disabled={uploading}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-xl transition"
                >
                  Choose file
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={e => handleFile(e.target.files[0])}
              />
            </div>

            {error && (
              <p className="mt-3 text-xs text-rose-400">{error}</p>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-indigo-400 uppercase tracking-widest mb-2">Portfolio</p>
          <h1 className="text-3xl font-bold text-white">Holdings</h1>
          {uploadedAt && (
            <p className="text-gray-600 mt-1.5 text-sm">
              Last updated {new Date(uploadedAt).toLocaleString()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {positions.length > 0 && (
            <>
              <button
                onClick={() => setShowTrend(v => !v)}
                className={`text-sm border rounded-xl px-4 py-2 transition ${showTrend ? "text-indigo-300 border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/15" : "text-gray-500 hover:text-gray-300 border-white/10 hover:border-white/20"}`}
              >
                {showTrend ? "Hide trend" : "Show 2 week trend"}
              </button>
              <button
                onClick={refreshPrices}
                disabled={refreshing}
                className="text-sm text-gray-500 hover:text-gray-300 border border-white/10 hover:border-white/20 rounded-xl px-4 py-2 transition disabled:opacity-50 flex items-center gap-1.5"
              >
                {refreshing ? (
                  <>
                    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Refreshing…
                  </>
                ) : "Refresh prices"}
              </button>
            </>
          )}
          <button
            onClick={() => { setError(""); setUploadModalOpen(true) }}
            className="text-sm text-gray-500 hover:text-gray-300 border border-white/10 hover:border-white/20 rounded-xl px-4 py-2 transition"
          >
            {positions.length === 0 ? "Upload portfolio" : "Update portfolio"}
          </button>
        </div>
      </div>

      {/* Refresh in-progress modal */}
      {refreshing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#13131f] border border-white/10 rounded-2xl px-10 py-8 flex flex-col items-center gap-4 shadow-2xl">
            <svg className="w-8 h-8 text-indigo-400 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <div className="text-center">
              <p className="text-white font-semibold text-sm">Refreshing prices</p>
              <p className="text-gray-500 text-xs mt-1">Fetching latest data from Yahoo Finance…</p>
            </div>
          </div>
        </div>
      )}

      {/* Error (outside modal, e.g. refresh errors) */}
      {error && !uploadModalOpen && (
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3 text-sm text-rose-400">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 rounded-xl bg-white/[0.03] animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && positions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7 text-indigo-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-white mb-1">No portfolio uploaded yet</p>
            <p className="text-xs text-gray-600">Export your positions from Saxo Bank and upload the .xlsx file</p>
          </div>
          <button
            onClick={() => setUploadModalOpen(true)}
            className="mt-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-sm font-medium text-white shadow-lg shadow-indigo-500/20 transition"
          >
            Upload portfolio
          </button>
        </div>
      )}

      {/* Summary stats + inline chart */}
      {!loading && positions.length > 0 && (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white/[0.03] border border-white/12 rounded-2xl px-5 py-5 flex flex-col justify-center">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Account Value (SGD)</p>
            <p className="text-3xl font-bold text-white mb-4">{fmt(accountValue)}</p>
            <div className="border-t border-white/5 pt-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Cash</span>
                <span className="text-xs text-gray-300 font-medium">{fmt(currentCash)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Stocks</span>
                <span className="text-xs text-gray-300 font-medium">{fmt(stocksMv)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Derivatives</span>
                <span className="text-xs text-gray-300 font-medium">{fmt(derivMv)}</span>
              </div>
            </div>
          </div>
          <div className="bg-white/[0.03] border border-white/12 rounded-2xl px-5 py-5 flex flex-col justify-center">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Total P&L (SGD)</p>
            <p className={`text-3xl font-bold ${pnlColor(totalPnl)}`}>
              {(totalPnl >= 0 ? "+" : "") + fmt(totalPnl)}
            </p>
          </div>
          <div className="col-span-2 bg-white/[0.03] border border-white/12 rounded-2xl px-5 py-5 flex flex-col justify-center">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">14-day Portfolio Value</p>
              {chartValues.length > 0 && (() => {
                const delta = chartValues[chartValues.length - 1] - chartValues[0]
                const base = (chartValues[0] + (chartCashSeries[0] ?? 0)) || 1
                const pct = (delta / Math.abs(base)) * 100
                return (
                  <span className={`text-xs font-medium ${delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {delta >= 0 ? "+" : ""}{fmt(delta, 0)} SGD ({pct >= 0 ? "+" : ""}{pct.toFixed(1)}%)
                  </span>
                )
              })()}
            </div>
            {pricesLoading ? (
              <div className="h-40 flex items-center justify-center">
                <div className="h-1.5 w-24 rounded bg-white/10 animate-pulse" />
              </div>
            ) : chartValues.length >= 2 ? (
              <PortfolioChart dates={priceDates} values={chartValues} cashSeries={chartCashSeries} height={160} />
            ) : (
              <div className="h-40 flex items-center justify-center">
                <p className="text-xs text-gray-600">Not enough price data available.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Grouped tables */}
      {!loading && orderedGroups.map(group => (
        <CollapsibleGroup
          key={group}
          group={group}
          positions={grouped[group]}
          priceDates={priceDates}
          priceMap={priceMap}
          pricesLoading={pricesLoading}
          trendDates={trendDates}
          showTrend={showTrend}
          onRequestPrices={() => fetchPrices(14)}
        />
      ))}
    </main>
  )
}
