import { useState, useEffect, useCallback, useRef } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { auth } from "../firebase"
import ReactECharts from "echarts-for-react"

async function getToken() {
  if (!auth.currentUser) return null
  return auth.currentUser.getIdToken()
}

async function apiFetch(path, opts = {}) {
  const token = await getToken()
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) }
  if (token) headers["Authorization"] = `Bearer ${token}`
  const res = await fetch(path, { ...opts, headers })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `${res.status} ${res.statusText}`)
  }
  return res.json()
}

const SCENARIOS = ["bear", "base", "bull"]

// Static Tailwind class maps — dynamic interpolation is not picked up by the Tailwind scanner
const SCENARIO_ACTIVE_CLS = {
  bear: "bg-rose-600 text-white",
  base: "bg-indigo-600 text-white",
  bull: "bg-emerald-600 text-white",
}
const SCENARIO_TEXT_CLS = {
  bear: "text-rose-400",
  base: "text-indigo-400",
  bull: "text-emerald-400",
}
const SCENARIO_BORDER_CLS = {
  bear: "border-rose-500/20",
  base: "border-indigo-500/20",
  bull: "border-emerald-500/20",
}

// ── Blank inputs for a new plan ────────────────────────────────────────────
// Only tax_rate is pre-populated; everything else starts null (shows blank inputs)
function makeBlankInputs(taxRate = 21) {
  const N = [null, null, null, null, null]
  return {
    bear: { revenue_growth: [...N], gross_margin: [...N], opex_growth: [...N], tax_rate: Array(5).fill(taxRate), pe_multiple: [...N] },
    base: { revenue_growth: [...N], gross_margin: [...N], opex_growth: [...N], tax_rate: Array(5).fill(taxRate), pe_multiple: [...N] },
    bull: { revenue_growth: [...N], gross_margin: [...N], opex_growth: [...N], tax_rate: Array(5).fill(taxRate), pe_multiple: [...N] },
  }
}

// ── Pure helpers ───────────────────────────────────────────────────────────

function r2(v) { return v != null ? Math.round(v * 100) / 100 : null }
function r4(v) { return v != null ? Math.round(v * 10000) / 10000 : null }

function fmtMoney(val) {
  if (val == null) return "—"
  return val.toLocaleString(undefined, { maximumFractionDigits: 0 })
}
function fmtEps(val) {
  if (val == null) return "—"
  return `$${val.toFixed(2)}`
}
function fmtPrice(val) {
  if (val == null) return "—"
  return `$${val.toFixed(2)}`
}
function fmtPct(val) {
  if (val == null) return "—"
  return `${val >= 0 ? "+" : ""}${val.toFixed(1)}%`
}
function fmtPE(val) {
  if (val == null) return "—"
  return `${val.toFixed(0)}×`
}

function computeAvgTaxRate(historical) {
  const rates = (historical.operating_income || [])
    .map((oi, i) => {
      const ni = historical.net_income?.[i]
      if (!oi || ni == null) return null
      return (1 - ni / oi) * 100
    })
    .filter(v => v != null)
  const last3 = rates.slice(-3)
  if (!last3.length) return 21
  return Math.round((last3.reduce((a, b) => a + b, 0) / last3.length) * 10) / 10
}

function computeHistDerived(historical) {
  const { revenue, gross_profit, op_expenses, operating_income, net_income, diluted_eps } = historical
  const ypx = historical.year_end_prices || []

  const revGrowth    = (revenue || []).map((r, i) =>
    (i === 0 || r == null || !revenue[i-1]) ? null : (r / revenue[i-1] - 1) * 100)
  const grossMargins = (revenue || []).map((r, i) =>
    (r == null || r === 0 || gross_profit?.[i] == null) ? null : (gross_profit[i] / r) * 100)
  const opexGrowth   = (op_expenses || []).map((o, i) =>
    (i === 0 || o == null || !op_expenses[i-1]) ? null : (o / op_expenses[i-1] - 1) * 100)
  const taxRates     = (operating_income || []).map((oi, i) => {
    const ni = net_income?.[i]
    if (!oi || ni == null) return null
    return (1 - ni / oi) * 100
  })
  // Use year-end stock prices for P/E context (not current price)
  const histPE = (diluted_eps || []).map((eps, i) => {
    const px = ypx[i]
    return (!px || !eps || eps <= 0) ? null : px / eps
  })

  return { revGrowth, grossMargins, opexGrowth, taxRates, histPE }
}

// Null-safe: if any key driver input is null for year i, output is null for that year
function projectFromInputs(inputs, historical, shares) {
  const lastRev  = (historical.revenue     || []).at(-1)
  const lastOpex = (historical.op_expenses || []).at(-1)

  const revenue = [], gross_profit = [], op_expenses = []
  const operating_income = [], net_income = [], diluted_eps = [], stock_price = []

  for (let i = 0; i < 5; i++) {
    const prevRev  = i === 0 ? lastRev  : revenue[i - 1]
    const prevOpex = i === 0 ? lastOpex : op_expenses[i - 1]

    const rg = inputs.revenue_growth[i]  // may be null
    const gm = inputs.gross_margin[i]    // may be null
    const og = inputs.opex_growth[i]     // may be null
    const tr = inputs.tax_rate[i] ?? 21  // always has a value
    const pe = inputs.pe_multiple[i]     // may be null

    const rev  = (prevRev  != null && rg != null) ? r2(prevRev  * (1 + rg / 100)) : null
    const gp   = (rev      != null && gm != null) ? r2(rev      * (gm / 100))      : null
    const opex = (prevOpex != null && og != null) ? r2(prevOpex * (1 + og / 100))  : null
    const oi   = (gp != null && opex != null)     ? r2(gp - opex)                  : null
    const ni   = oi  != null                      ? r2(oi  * (1 - tr / 100))       : null
    const eps  = (ni != null && shares)           ? r4((ni * 1e6) / shares)         : null
    const px   = (eps != null && pe != null && pe !== 0) ? r2(eps * pe)             : null

    revenue.push(rev)
    gross_profit.push(gp)
    op_expenses.push(opex)
    operating_income.push(oi)
    net_income.push(ni)
    diluted_eps.push(eps)
    stock_price.push(px)
  }

  return { revenue, gross_profit, op_expenses, operating_income, net_income, diluted_eps, stock_price }
}

// ── Scenario line chart ────────────────────────────────────────────────────

function ScenarioChart({ cells, currentPrice, forecastYears }) {
  const xData = ["Now", ...forecastYears.map(y => `${y}F`)]

  function makeSeriesData(s) {
    const prices = cells?.[s]?.stock_price || []
    return [currentPrice ?? null, ...prices].map(v => v ?? null)
  }

  const option = {
    backgroundColor: "transparent",
    grid: { top: 20, right: 20, bottom: 30, left: 60 },
    xAxis: {
      type: "category",
      data: xData,
      axisLine: { lineStyle: { color: "#374151" } },
      axisTick: { lineStyle: { color: "#374151" } },
      axisLabel: { color: "#6b7280", fontSize: 11 },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#6b7280", fontSize: 11, formatter: v => `$${Number(v).toFixed(0)}` },
      splitLine: { lineStyle: { color: "#1f2937" } },
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: "#16162a",
      borderColor: "#374151",
      textStyle: { color: "#e5e7eb", fontSize: 12 },
      formatter: params =>
        params.map(p => `<b style="color:${p.color}">${p.seriesName}</b> ${p.value != null ? `$${Number(p.value).toFixed(2)}` : "—"}`).join("<br/>"),
    },
    series: [
      { name: "Bear", data: makeSeriesData("bear"), type: "line", smooth: true,
        lineStyle: { color: "#f43f5e", width: 2 }, itemStyle: { color: "#f43f5e" },
        connectNulls: false, symbol: "circle", symbolSize: 5 },
      { name: "Base", data: makeSeriesData("base"), type: "line", smooth: true,
        lineStyle: { color: "#6366f1", width: 2 }, itemStyle: { color: "#6366f1" },
        connectNulls: false, symbol: "circle", symbolSize: 5 },
      { name: "Bull", data: makeSeriesData("bull"), type: "line", smooth: true,
        lineStyle: { color: "#10b981", width: 2 }, itemStyle: { color: "#10b981" },
        connectNulls: false, symbol: "circle", symbolSize: 5 },
    ],
  }

  return <ReactECharts option={option} style={{ height: 200 }} opts={{ renderer: "svg" }} />
}

// ── Ticker search bar ──────────────────────────────────────────────────────

function TickerSearch({ value, onChange, onSelect, disabled }) {
  const [query, setQuery]   = useState(value || "")
  const [results, setResults] = useState([])
  const [open, setOpen]     = useState(false)
  const debounceRef         = useRef(null)

  useEffect(() => { setQuery(value || "") }, [value])

  function handleInput(e) {
    const q = e.target.value.toUpperCase()
    setQuery(q)
    onChange(q)
    clearTimeout(debounceRef.current)
    if (q.length < 1) { setResults([]); setOpen(false); return }
    debounceRef.current = setTimeout(async () => {
      try {
        const d = await apiFetch(`/api/tickers/search?q=${encodeURIComponent(q)}`)
        setResults(d.results || d || [])
        setOpen(true)
      } catch { setResults([]) }
    }, 200)
  }

  function handleSelect(t) {
    setQuery(t.symbol || t.ticker || t)
    setOpen(false)
    onSelect(t.symbol || t.ticker || t)
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={handleInput}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        disabled={disabled}
        placeholder="Search ticker…"
        className="bg-white/5 border border-white/10 rounded-xl text-white text-sm px-3 py-2 w-44 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 placeholder-gray-500"
      />
      {open && results.length > 0 && (
        <div className="absolute top-full mt-1 left-0 z-50 bg-[#16162a] border border-white/10 rounded-xl shadow-xl w-64 overflow-hidden">
          {results.slice(0, 8).map((r, i) => (
            <button
              key={i}
              onMouseDown={() => handleSelect(r)}
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 text-left transition-colors"
            >
              <span className="font-bold text-white text-sm w-16 shrink-0">{r.symbol || r.ticker || r}</span>
              <span className="text-gray-400 text-xs truncate">{r.name || r.company || ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function PlanningPage() {
  const navigate    = useNavigate()
  const { ticker: tickerParam } = useParams()
  const [searchParams] = useSearchParams()
  const planIdFromUrl  = searchParams.get("planId")
  const isNew          = tickerParam === "new"

  const [planId, setPlanId]           = useState(isNew ? null : planIdFromUrl)
  const [planName, setPlanName]       = useState("")
  const [ticker, setTicker]           = useState(isNew ? "" : (tickerParam || ""))
  const [historical, setHistorical]   = useState(null)
  const [loadingHist, setLoadingHist] = useState(false)
  const [histError, setHistError]     = useState("")

  const [scenarioInputs, setScenarioInputs] = useState(makeBlankInputs())
  const [cells, setCells]               = useState(null)
  const [shares, setShares]             = useState(null)
  const [currentPrice, setCurrentPrice] = useState(null)
  const [avgTaxRate, setAvgTaxRate]     = useState(21)
  const [histDerived, setHistDerived]   = useState(null)
  const [activeScenario, setActiveScenario] = useState("base")
  const [stripExpanded, setStripExpanded]   = useState(false)
  const [notes, setNotes]               = useState("")

  const [saving, setSaving]         = useState(false)
  const [saveError, setSaveError]   = useState("")
  const [saved, setSaved]           = useState(false)

  // ── Load existing plan ─────────────────────────────────────────────────
  useEffect(() => {
    if (!planId) return
    apiFetch(`/api/plans/${planId}`)
      .then(plan => {
        setPlanName(plan.name || "")
        setTicker(plan.ticker || "")
        setShares(plan.shares_outstanding || null)
        setCurrentPrice(plan.current_price || null)
        setHistorical(plan.historical || null)
        setNotes(plan.notes || "")

        const hist = plan.historical
        const tr = plan.avg_tax_rate != null ? plan.avg_tax_rate : (hist ? computeAvgTaxRate(hist) : 21)
        setAvgTaxRate(tr)
        if (hist) setHistDerived(computeHistDerived(hist))

        // Build inputs from saved data; use makeBlankInputs as empty base (not seeded defaults)
        const newInputs = makeBlankInputs(21)
        const newCells  = { bear: null, base: null, bull: null }
        for (const s of SCENARIOS) {
          const sc = plan.scenarios?.[s]
          if (!sc) continue
          const inp = { ...newInputs[s] }
          inp.revenue_growth = sc.revenue_growth_by_year?.map(v => v * 100) ?? Array(5).fill(null)
          inp.gross_margin   = sc.gross_margin_by_year?.map(v => v * 100)   ?? Array(5).fill(null)
          inp.opex_growth    = sc.opex_growth_by_year?.map(v => v * 100)    ?? Array(5).fill(null)
          inp.tax_rate       = sc.tax_rate_by_year?.map(v => v * 100)       ?? Array(5).fill(tr)
          inp.pe_multiple    = sc.pe_by_year                                 ?? Array(5).fill(null)
          newInputs[s] = inp

          if (sc.cells) {
            const eps = sc.cells.diluted_eps || []
            newCells[s] = {
              ...sc.cells,
              stock_price: inp.pe_multiple.map((pe, i) =>
                eps[i] != null && pe != null && pe !== 0 ? r2(eps[i] * pe) : null),
            }
          }
        }
        setScenarioInputs(newInputs)
        setCells(newCells)
      })
      .catch(e => setHistError("Failed to load plan: " + e.message))
  }, [planId])

  // ── Fetch historical when ticker changes ───────────────────────────────
  useEffect(() => {
    if (!ticker || ticker.length < 1) return
    if (planId) return  // existing plan: historical is loaded by the plan-load effect
    setLoadingHist(true)
    setHistError("")
    apiFetch(`/api/financials/${ticker}`)
      .then(data => {
        setHistorical(data)
        setShares(data.shares_outstanding || null)
        setCurrentPrice(data.current_price || null)
        const tr = computeAvgTaxRate(data)
        setAvgTaxRate(tr)
        setHistDerived(computeHistDerived(data))
        // New plan: start with blank inputs but seed tax_rate from historical avg
        const newInputs = makeBlankInputs(21)
        const newCells  = {}
        for (const s of SCENARIOS) {
          newCells[s] = projectFromInputs(newInputs[s], data, data.shares_outstanding)
        }
        setScenarioInputs(newInputs)
        setCells(newCells)
      })
      .catch(e => setHistError(e.message))
      .finally(() => setLoadingHist(false))
  }, [ticker])

  // ── Input change handler ───────────────────────────────────────────────
  const handleInputChange = useCallback((scenario, field, yearIdx, rawVal) => {
    // Empty string → null (clears the cell); otherwise parse float
    const val = rawVal === "" ? null : parseFloat(rawVal)
    if (rawVal !== "" && isNaN(val)) return
    setScenarioInputs(prev => {
      const arr = [...(prev[scenario][field] || Array(5).fill(null))]
      arr[yearIdx] = val
      const newS = { ...prev[scenario], [field]: arr }
      const newAll = { ...prev, [scenario]: newS }
      if (historical) {
        setCells(prevCells => ({
          ...prevCells,
          [scenario]: projectFromInputs(newS, historical, shares),
        }))
      }
      return newAll
    })
  }, [historical, shares])

  // ── Save ───────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!ticker)         return setSaveError("Please select a ticker first")
    if (!planName.trim()) return setSaveError("Please enter a plan name")
    if (!historical)     return setSaveError("Please load financial data first")
    if (!cells)          return setSaveError("No projection data to save")

    setSaving(true)
    setSaveError("")
    setSaved(false)

    const scenarios = {}
    for (const s of SCENARIOS) {
      const inp = scenarioInputs[s]
      scenarios[s] = {
        revenue_cagr:           0,
        gross_margin_target:    0,
        opex_cagr:              0,
        pe_multiple:            inp.pe_multiple[4] ?? 0,
        revenue_growth_by_year: inp.revenue_growth.map(v => (v ?? 0) / 100),
        gross_margin_by_year:   inp.gross_margin.map(v => (v ?? 0) / 100),
        opex_growth_by_year:    inp.opex_growth.map(v => (v ?? 0) / 100),
        tax_rate_by_year:       inp.tax_rate.map(v => (v ?? 21) / 100),
        pe_by_year:             inp.pe_multiple,
        cells:                  cells[s],
      }
    }

    try {
      const result = await apiFetch("/api/plans", {
        method: "POST",
        body: JSON.stringify({
          id:                 planId || null,
          name:               planName.trim(),
          ticker:             ticker.toUpperCase(),
          shares_outstanding: shares,
          current_price:      currentPrice,
          input_mode:         "yearly",
          avg_tax_rate:       avgTaxRate,
          notes:              notes,
          historical: {
            years:             historical.years,
            revenue:           historical.revenue,
            gross_profit:      historical.gross_profit,
            op_expenses:       historical.op_expenses,
            operating_income:  historical.operating_income,
            net_income:        historical.net_income,
            diluted_eps:       historical.diluted_eps,
            year_end_prices:   historical.year_end_prices || [],
          },
          scenarios,
        }),
      })
      setPlanId(result.id)
      setSaved(true)
      navigate(`/app/plans/${ticker.toUpperCase()}?planId=${result.id}`, { replace: true })
    } catch (e) {
      setSaveError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Derived values ─────────────────────────────────────────────────────
  const histYears    = historical?.years || []
  const forecastYears = histYears.length > 0
    ? Array.from({ length: 5 }, (_, i) => String(parseInt(histYears.at(-1)) + i + 1))
    : ["Y1", "Y2", "Y3", "Y4", "Y5"]

  const totalCols = histYears.length + forecastYears.length + 2  // +2: label col + separator

  function y5Price(s)   { return cells?.[s]?.stock_price?.[4] ?? null }
  function upsidePct(s) {
    const px = y5Price(s)
    if (px == null || !currentPrice) return null
    return (px - currentPrice) / currentPrice * 100
  }

  const inputCls = "w-full bg-white/5 border border-white/10 rounded-md text-white text-xs text-center px-1 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <button
          onClick={() => navigate("/app/plans")}
          className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Plans
        </button>

        <TickerSearch
          value={ticker}
          onChange={setTicker}
          onSelect={t => setTicker(t)}
          disabled={!!planId && !!historical}
        />

        <input
          type="text"
          value={planName}
          onChange={e => setPlanName(e.target.value)}
          placeholder="Plan name (e.g. NVDA Bull Case 2029)"
          className="flex-1 min-w-[220px] bg-white/5 border border-white/10 rounded-xl text-white text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 placeholder-gray-500"
        />

        <button
          onClick={handleSave}
          disabled={saving}
          className="ml-auto flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-xl shadow-lg shadow-indigo-500/20 transition-colors"
        >
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save Plan"}
        </button>
      </div>

      {saveError && (
        <div className="mb-4 bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 text-rose-400 text-sm">{saveError}</div>
      )}
      {loadingHist && (
        <div className="text-center py-8 text-gray-500 text-sm">Loading financials for {ticker}…</div>
      )}
      {histError && !loadingHist && (
        <div className="mb-4 bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 text-rose-400 text-sm">{histError}</div>
      )}
      {!historical && !loadingHist && !histError && (
        <div className="bg-white/[0.02] border border-white/8 rounded-2xl p-16 flex items-center justify-center text-gray-500 text-sm">
          Search for a ticker above to load historical financials
        </div>
      )}

      {historical && cells && (
        <>
          {/* ── Expandable scenario strip ────────────────────────────── */}
          <div className="mb-4 bg-white/[0.02] border border-white/8 rounded-2xl overflow-hidden">
            <button
              onClick={() => setStripExpanded(v => !v)}
              className="w-full flex items-center gap-4 px-5 py-3 hover:bg-white/[0.02] transition-colors flex-wrap"
            >
              {currentPrice && (
                <div className="flex items-center gap-2 mr-2">
                  <span className="text-[11px] text-gray-500 uppercase tracking-wider">Current</span>
                  <span className="text-sm font-bold text-white">${currentPrice.toFixed(2)}</span>
                </div>
              )}
              <div className="w-px h-5 bg-white/10 shrink-0"></div>
              {SCENARIOS.map(s => {
                const px = y5Price(s)
                const up = upsidePct(s)
                return (
                  <div key={s} className="flex items-center gap-2">
                    <span className={`text-[11px] font-semibold uppercase tracking-wider ${SCENARIO_TEXT_CLS[s]}`}>{s} Y5</span>
                    <span className="text-sm font-bold text-white">{px != null ? `$${px.toFixed(2)}` : "—"}</span>
                    {up != null && (
                      <span className={`text-xs font-medium ${up >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {up >= 0 ? "+" : ""}{up.toFixed(1)}%
                      </span>
                    )}
                    <div className="w-px h-4 bg-white/10 shrink-0"></div>
                  </div>
                )
              })}
              <svg
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                className={`w-4 h-4 text-gray-500 ml-auto transition-transform ${stripExpanded ? "rotate-180" : ""}`}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>

            {stripExpanded && (
              <div className="px-4 pb-4 border-t border-white/8">
                <ScenarioChart cells={cells} currentPrice={currentPrice} forecastYears={forecastYears} />
              </div>
            )}
          </div>

          {/* ── Unified table ───────────────────────────────────────── */}
          <div className="bg-white/[0.02] border border-white/8 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/8">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Forecast Plan</span>
              <div className="flex items-center gap-1">
                {SCENARIOS.map(s => (
                  <button
                    key={s}
                    onClick={() => setActiveScenario(s)}
                    className={`px-4 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors ${
                      activeScenario === s
                        ? SCENARIO_ACTIVE_CLS[s]
                        : "text-gray-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-white/8">
                    <th className="px-4 py-2.5 text-left text-[11px] text-gray-500 font-medium sticky left-0 bg-[#0a0a0f] w-52 min-w-[13rem]">
                      Metric
                    </th>
                    {histYears.map(y => (
                      <th key={y} className="px-2 py-2.5 text-right text-[11px] text-gray-600 font-medium w-20 min-w-[4.5rem]">{y}A</th>
                    ))}
                    <th className="w-1 p-0 bg-white/10"></th>
                    {forecastYears.map(y => (
                      <th key={y} className="px-2 py-2.5 text-center text-[11px] text-indigo-400/70 font-semibold w-20 min-w-[4.5rem]">{y}F</th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {/* ── Assumptions section ─────────────────────────── */}
                  <SectionHeader label="Assumptions — edit to update forecast" colSpan={totalCols} bgCls="bg-indigo-500/[0.06] border-indigo-500/10" textCls="text-indigo-400/70" />

                  <AssumptionRow
                    label="Revenue Growth (%)"
                    histValues={histDerived?.revGrowth}
                    fmtHist={v => fmtPct(v)}
                    forecastValues={scenarioInputs[activeScenario].revenue_growth}
                    onEdit={(i, v) => handleInputChange(activeScenario, "revenue_growth", i, v)}
                    inputCls={inputCls}
                  />
                  <AssumptionRow
                    label="Gross Margin (%)"
                    histValues={histDerived?.grossMargins}
                    fmtHist={v => v != null ? `${v.toFixed(1)}%` : "—"}
                    forecastValues={scenarioInputs[activeScenario].gross_margin}
                    onEdit={(i, v) => handleInputChange(activeScenario, "gross_margin", i, v)}
                    inputCls={inputCls}
                  />
                  <AssumptionRow
                    label="OpEx Growth (%)"
                    histValues={histDerived?.opexGrowth}
                    fmtHist={v => fmtPct(v)}
                    forecastValues={scenarioInputs[activeScenario].opex_growth}
                    onEdit={(i, v) => handleInputChange(activeScenario, "opex_growth", i, v)}
                    inputCls={inputCls}
                  />
                  <AssumptionRow
                    label={`Tax Rate (%) — 3Y avg ${avgTaxRate.toFixed(1)}%`}
                    histValues={histDerived?.taxRates}
                    fmtHist={v => v != null ? `${v.toFixed(1)}%` : "—"}
                    forecastValues={scenarioInputs[activeScenario].tax_rate}
                    onEdit={(i, v) => handleInputChange(activeScenario, "tax_rate", i, v)}
                    inputCls={inputCls}
                  />
                  <AssumptionRow
                    label="P/E Multiple (×)"
                    histValues={histDerived?.histPE}
                    fmtHist={v => fmtPE(v)}
                    forecastValues={scenarioInputs[activeScenario].pe_multiple}
                    onEdit={(i, v) => handleInputChange(activeScenario, "pe_multiple", i, v)}
                    inputCls={inputCls}
                    step="1"
                  />

                  {/* ── Income Statement section ─────────────────────── */}
                  <SectionHeader label="Income Statement" colSpan={totalCols} bgCls="bg-white/[0.02] border-white/8" textCls="text-gray-500" />

                  {[
                    { key: "revenue",          label: "Revenue ($M)",          fmt: fmtMoney },
                    { key: "gross_profit",     label: "Gross Profit ($M)",     fmt: fmtMoney },
                    { key: "op_expenses",      label: "Op. Expenses ($M)",     fmt: fmtMoney },
                    { key: "operating_income", label: "Operating Income ($M)", fmt: fmtMoney },
                    { key: "net_income",       label: "Net Income ($M)",       fmt: fmtMoney },
                    { key: "diluted_eps",      label: "EPS (diluted)",         fmt: fmtEps   },
                  ].map(({ key, label, fmt }) => (
                    <OutputRow
                      key={key}
                      label={label}
                      histValues={historical[key] || []}
                      forecastValues={cells[activeScenario]?.[key] || []}
                      fmt={fmt}
                    />
                  ))}

                  {/* ── Valuation section ────────────────────────────── */}
                  <SectionHeader label="Valuation" colSpan={totalCols} bgCls="bg-emerald-500/[0.04] border-emerald-500/10" textCls="text-emerald-400/70" />

                  {/* Stock Price row — historical shows year-end prices */}
                  <tr className="bg-emerald-500/[0.03] hover:bg-emerald-500/[0.05] border-b border-white/[0.03]">
                    <td className="px-4 py-3 font-semibold text-white sticky left-0 bg-emerald-500/[0.03] w-52 min-w-[13rem]">
                      Stock Price ($)
                    </td>
                    {histYears.map((_, i) => (
                      <td key={i} className="px-2 py-3 text-right text-gray-400 bg-white/[0.01]">
                        {historical.year_end_prices?.[i] != null
                          ? `$${historical.year_end_prices[i].toFixed(2)}`
                          : "—"}
                      </td>
                    ))}
                    <td className="w-1 p-0 bg-white/10"></td>
                    {(cells[activeScenario]?.stock_price || []).map((px, i) => (
                      <td key={i} className="px-2 py-3 text-center">
                        <span className={`text-sm font-bold ${px != null ? "text-white" : "text-gray-600"}`}>
                          {fmtPrice(px)}
                        </span>
                        {px != null && currentPrice && (
                          <div className={`text-[10px] font-medium mt-0.5 ${
                            ((px - currentPrice) / currentPrice) >= 0 ? "text-emerald-400" : "text-rose-400"
                          }`}>
                            {((px - currentPrice) / currentPrice * 100) >= 0 ? "+" : ""}
                            {((px - currentPrice) / currentPrice * 100).toFixed(0)}%
                          </div>
                        )}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="px-5 py-2.5 border-t border-white/5 text-[10px] text-gray-600">
              Values in $M except EPS and Stock Price. Tax rate pre-populated from 3Y historical average — edit per year as needed.
            </div>
          </div>

          {/* ── Notes ───────────────────────────────────────────────── */}
          <div className="mt-4 bg-white/[0.02] border border-white/8 rounded-2xl p-5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Notes</h3>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Write your investment thesis, key risks, or any other thoughts…"
              rows={4}
              className="w-full bg-white/5 border border-white/10 rounded-xl text-white text-sm px-3 py-2.5 resize-y focus:outline-none focus:ring-1 focus:ring-indigo-500/50 placeholder-gray-500"
            />
          </div>
        </>
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SectionHeader({ label, colSpan, bgCls, textCls }) {
  return (
    <tr>
      <td colSpan={colSpan} className={`px-4 py-1.5 border-y ${bgCls}`}>
        <span className={`text-[10px] font-semibold uppercase tracking-widest ${textCls}`}>{label}</span>
      </td>
    </tr>
  )
}

function AssumptionRow({ label, histValues, fmtHist, forecastValues, onEdit, inputCls, step = "0.1" }) {
  return (
    <tr className="bg-indigo-500/[0.03] hover:bg-indigo-500/[0.05] border-b border-white/[0.03]">
      <td className="px-4 py-2 text-indigo-200/80 font-medium sticky left-0 bg-indigo-500/[0.03] w-52 min-w-[13rem]">
        {label}
      </td>
      {(histValues || []).map((v, i) => (
        <td key={i} className="px-2 py-2 text-right text-gray-500 bg-white/[0.01]">{fmtHist(v)}</td>
      ))}
      <td className="w-1 p-0 bg-white/10"></td>
      {(forecastValues || []).map((val, i) => (
        <td key={i} className="px-1.5 py-1.5">
          <input
            type="number"
            step={step}
            value={val ?? ""}
            onChange={e => onEdit(i, e.target.value)}
            className={inputCls}
          />
        </td>
      ))}
    </tr>
  )
}

function OutputRow({ label, histValues, forecastValues, fmt }) {
  return (
    <tr className="hover:bg-white/[0.015] border-b border-white/[0.03]">
      <td className="px-4 py-2.5 text-gray-400 sticky left-0 bg-[#0a0a0f] w-52 min-w-[13rem]">{label}</td>
      {(histValues || []).map((v, i) => (
        <td key={i} className="px-2 py-2.5 text-right text-gray-400 bg-white/[0.01]">{fmt(v)}</td>
      ))}
      <td className="w-1 p-0 bg-white/10"></td>
      {(forecastValues || []).map((v, i) => (
        <td key={i} className="px-2 py-2.5 text-right text-white/75 bg-indigo-500/[0.02]">{fmt(v)}</td>
      ))}
    </tr>
  )
}
