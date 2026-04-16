import { useState, useEffect, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { auth } from "../firebase"

// ── Auth helper ──────────────────────────────────────────────────────────────

async function getToken() {
  if (!auth.currentUser) return null
  return auth.currentUser.getIdToken()
}

async function apiFetch(path, opts = {}) {
  const token = await getToken()
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) }
  if (token) headers["Authorization"] = `Bearer ${token}`
  const res = await fetch(path, { ...opts, headers })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

// ── Formatters ───────────────────────────────────────────────────────────────

function fmtPrice(n) {
  if (n == null) return "—"
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(n) {
  if (n == null) return "—"
  const v = Number(n) * 100
  return (v >= 0 ? "+" : "") + v.toFixed(2) + "%"
}

function fmtMarketCap(n) {
  if (n == null) return "—"
  const v = Number(n)
  if (v >= 1e12) return "$" + (v / 1e12).toFixed(2) + "T"
  if (v >= 1e9)  return "$" + (v / 1e9).toFixed(2) + "B"
  if (v >= 1e6)  return "$" + (v / 1e6).toFixed(2) + "M"
  return "$" + v.toLocaleString()
}

function fmtVol(n) {
  if (n == null) return "—"
  const v = Number(n)
  if (v >= 1e9) return (v / 1e9).toFixed(2) + "B"
  if (v >= 1e6) return (v / 1e6).toFixed(2) + "M"
  if (v >= 1e3) return (v / 1e3).toFixed(0) + "K"
  return String(v)
}

function fmtNum(n, decimals = 2) {
  if (n == null) return "—"
  return Number(n).toFixed(decimals)
}

function fmtIVRank(n) {
  if (n == null) return "—"
  return Number(n).toFixed(0)
}

function fmtField(key, value) {
  if (value == null) return "—"
  if (key === "ticker" || key === "name" || key === "sector" || key === "industry") {
    return typeof value === "string" ? value : String(value)
  }
  const pctFields = new Set([
    "price_1d_chg_pct", "price_5d_chg_pct", "price_1mo_chg_pct", "price_3mo_chg_pct",
    "pct_from_52w_high", "pct_from_52w_low", "dividend_yield", "revenue_growth",
    "earnings_growth", "profit_margin", "return_on_equity", "iv_current",
    "expected_move_1m",
  ])
  if (key === "market_cap") return fmtMarketCap(value)
  if (key === "current_price" || key === "ma_50" || key === "ma_200" ||
      key === "week_52_high" || key === "week_52_low") return fmtPrice(value)
  if (pctFields.has(key)) return fmtPct(value)
  if (key === "volume_today" || key === "avg_volume_30d") return fmtVol(value)
  if (key === "iv_rank") return fmtIVRank(value)
  if (key === "has_options") return value ? "Yes" : "No"
  if (key === "volume_ratio") return fmtNum(value, 2) + "×"
  if (key === "atm_theta") return "$" + Number(value).toFixed(3) + "/day"
  if (key === "atm_gamma") return Number(value).toFixed(4)
  if (key === "atm_vega")  return "$" + Number(value).toFixed(3)
  return fmtNum(value, 2)
}

function pctColor(n) {
  if (n == null) return "text-gray-500"
  return Number(n) >= 0 ? "text-emerald-400" : "text-rose-400"
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ScreenerStatus({ status }) {
  if (!status) return null
  if (!status.available) {
    return (
      <p className="text-xs text-amber-400/80 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mb-4">
        Screener database not configured — set SUPABASE_URL and SUPABASE_ANON_KEY in backend .env
      </p>
    )
  }
  if (status.phase1_count === 0) {
    return (
      <p className="text-xs text-amber-400/80 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mb-4">
        No screener data yet — run the nightly refresh script to populate data
      </p>
    )
  }
  return (
    <p className="text-xs text-gray-600 mb-4">
      Screening{" "}
      <span className="text-gray-400">{status.phase1_count.toLocaleString()}</span>
      {" "}US-listed stocks
    </p>
  )
}

function PresetPill({ preset, active, onClick, onDelete, isUser }) {
  return (
    <div className="relative group">
      <button
        onClick={onClick}
        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
          active
            ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
            : "bg-white/[0.04] text-gray-400 border border-white/8 hover:text-gray-200 hover:bg-white/[0.07]"
        }`}
      >
        {preset.name}
      </button>
      {isUser && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(preset.id) }}
          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[#0a0a0f] border border-white/10
                     text-gray-600 hover:text-rose-400 hidden group-hover:flex items-center justify-center text-[9px]"
          title="Delete preset"
        >
          ×
        </button>
      )}
    </div>
  )
}

const OP_LABELS = {
  gte: "≥",
  lte: "≤",
  eq: "=",
  neq: "≠",
  in: "is one of",
}

const selectCls = "bg-white/5 border border-white/10 rounded-xl text-sm text-white px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 transition"

function FilterRow({ filter, fieldMeta, onChange, onRemove }) {
  const meta = fieldMeta.find((f) => f.key === filter.field) || {}
  const isEnum = meta.type === "enum"
  const isBool = meta.type === "boolean"
  const isText = meta.type === "text"

  const availableOps = isBool
    ? [{ value: "eq", label: "is" }]
    : isEnum
    ? [{ value: "eq", label: "=" }, { value: "neq", label: "≠" }, { value: "in", label: "is one of" }]
    : isText
    ? [{ value: "eq", label: "=" }, { value: "neq", label: "≠" }]
    : [
        { value: "gte", label: "≥" },
        { value: "lte", label: "≤" },
        { value: "eq",  label: "=" },
        { value: "neq", label: "≠" },
      ]

  // When field type changes, reset op and value
  function handleFieldChange(newField) {
    const newMeta = fieldMeta.find((f) => f.key === newField) || {}
    const defaultOp = newMeta.type === "boolean" ? "eq"
                    : newMeta.type === "enum"    ? "eq"
                    : "lte"
    const defaultVal = newMeta.type === "boolean" ? true : ""
    onChange({ ...filter, field: newField, op: defaultOp, value: defaultVal })
  }

  // Group fields by category for <optgroup>
  const categories = {}
  for (const f of fieldMeta) {
    if (!categories[f.category]) categories[f.category] = []
    categories[f.category].push(f)
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Field select */}
      <select
        value={filter.field}
        onChange={(e) => handleFieldChange(e.target.value)}
        className={`${selectCls} min-w-[180px]`}
      >
        {Object.entries(categories).map(([cat, fields]) => (
          <optgroup key={cat} label={cat}>
            {fields.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </optgroup>
        ))}
      </select>

      {/* Operator select */}
      <select
        value={filter.op}
        onChange={(e) => onChange({ ...filter, op: e.target.value })}
        className={selectCls}
      >
        {availableOps.map((op) => (
          <option key={op.value} value={op.value}>{op.label}</option>
        ))}
      </select>

      {/* Value input */}
      {isBool ? (
        <select
          value={String(filter.value)}
          onChange={(e) => onChange({ ...filter, value: e.target.value === "true" })}
          className={selectCls}
        >
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      ) : isEnum && filter.op === "in" ? (
        <div className="flex flex-wrap gap-1 max-w-xs">
          {(meta.options || []).map((opt) => {
            const selected = Array.isArray(filter.value) && filter.value.includes(opt)
            return (
              <button
                key={opt}
                onClick={() => {
                  const arr = Array.isArray(filter.value) ? filter.value : []
                  onChange({
                    ...filter,
                    value: selected ? arr.filter((v) => v !== opt) : [...arr, opt],
                  })
                }}
                className={`px-2 py-0.5 rounded text-xs transition ${
                  selected
                    ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                    : "bg-white/5 text-gray-400 border border-white/8 hover:text-white"
                }`}
              >
                {opt}
              </button>
            )
          })}
        </div>
      ) : isEnum ? (
        <select
          value={filter.value || ""}
          onChange={(e) => onChange({ ...filter, value: e.target.value })}
          className={selectCls}
        >
          <option value="">Select…</option>
          {(meta.options || []).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : (
        <input
          type="number"
          value={filter.value ?? ""}
          onChange={(e) => onChange({ ...filter, value: e.target.value === "" ? "" : Number(e.target.value) })}
          placeholder={
            meta.formatter === "percent" ? "e.g. 0.10 (= 10%)"
            : meta.formatter === "market_cap" ? "e.g. 1000000000"
            : "value"
          }
          className="bg-white/5 border border-white/10 rounded-lg text-sm text-white px-2.5 py-1.5 w-44
                     focus:outline-none focus:ring-1 focus:ring-indigo-500/50 placeholder-gray-700"
        />
      )}

      {/* Options signal badge */}
      {meta.requires_options && (
        <span className="text-[10px] text-indigo-400/60 border border-indigo-500/15 rounded px-1.5 py-0.5">
          options only
        </span>
      )}

      {/* Remove */}
      <button
        onClick={onRemove}
        className="text-gray-700 hover:text-rose-400 transition ml-1"
        title="Remove filter"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

const RESULT_COLUMNS = [
  { key: "ticker",            label: "Ticker",     sortable: true },
  { key: "name",              label: "Name",       sortable: true },
  { key: "current_price",     label: "Price",      sortable: true },
  { key: "price_1mo_chg_pct", label: "1M %",       sortable: true, colorize: true },
  { key: "market_cap",        label: "Mkt Cap",    sortable: true },
  { key: "pe_ratio",          label: "P/E",        sortable: true },
  { key: "forward_pe",        label: "Fwd P/E",    sortable: true },
  { key: "revenue_growth",    label: "Rev Gr",     sortable: true, colorize: true },
  { key: "profit_margin",     label: "Margin",     sortable: true, colorize: true },
  { key: "sector",            label: "Sector",     sortable: true },
  { key: "iv_rank",           label: "IV Rank",    sortable: true },
  { key: "volume_ratio",      label: "Vol ×",      sortable: true },
]

function SortChevron({ active, dir }) {
  if (!active) return <span className="text-gray-700 ml-0.5">↕</span>
  return <span className="text-indigo-400 ml-0.5">{dir === "desc" ? "↓" : "↑"}</span>
}

function ResultsTable({ results, total, page, pageSize, sortField, sortDir, loading, onSort, onPage, onRowClick, planTickers = new Set() }) {
  if (!loading && results.length === 0) {
    return (
      <div className="bg-white/[0.02] border border-white/8 rounded-2xl p-10 text-center mt-4">
        <p className="text-gray-500 text-sm">No stocks match the current filters.</p>
      </div>
    )
  }

  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-600">
          {loading ? "Searching…" : `${total.toLocaleString()} results`}
        </p>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPage(page - 1)}
              disabled={page <= 1 || loading}
              className="px-2 py-1 text-xs rounded bg-white/5 border border-white/8 text-gray-400
                         hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              ←
            </button>
            <span className="text-xs text-gray-500 px-1">{page} / {totalPages}</span>
            <button
              onClick={() => onPage(page + 1)}
              disabled={page >= totalPages || loading}
              className="px-2 py-1 text-xs rounded bg-white/5 border border-white/8 text-gray-400
                         hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              →
            </button>
          </div>
        )}
      </div>

      <div className="bg-white/[0.02] border border-white/8 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                {RESULT_COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => col.sortable && onSort(col.key)}
                    className={`px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap
                      ${col.sortable ? "cursor-pointer hover:text-gray-300 select-none" : ""}`}
                  >
                    {col.label}
                    {col.sortable && <SortChevron active={sortField === col.key} dir={sortDir} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-white/[0.03]">
                      {RESULT_COLUMNS.map((col) => (
                        <td key={col.key} className="px-4 py-3">
                          <div className="h-3 rounded bg-white/5 animate-pulse" style={{ width: col.key === "name" ? "120px" : "60px" }} />
                        </td>
                      ))}
                    </tr>
                  ))
                : results.map((row) => (
                    <tr
                      key={row.ticker}
                      onClick={() => onRowClick(row.ticker)}
                      className="border-b border-white/[0.03] cursor-pointer hover:bg-white/[0.03] transition"
                    >
                      {RESULT_COLUMNS.map((col) => (
                        <td key={col.key} className={`px-4 py-3 ${col.key === "ticker" ? "font-semibold text-white" : "text-gray-400"}`}>
                          {col.colorize
                            ? <span className={pctColor(row[col.key])}>{fmtField(col.key, row[col.key])}</span>
                            : col.key === "sector"
                            ? <span className="text-xs bg-white/5 border border-white/8 rounded px-1.5 py-0.5 text-gray-400">
                                {row[col.key] || "—"}
                              </span>
                            : col.key === "ticker"
                            ? <span className="flex items-center gap-1.5">
                                {row[col.key]}
                                {planTickers.has(row[col.key]) && (
                                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3 text-indigo-400 shrink-0" title="Forecast plan exists">
                                    <path d="M6.32 2.577a49.255 49.255 0 0111.36 0c1.497.174 2.57 1.46 2.57 2.93V21a.75.75 0 01-1.085.67L12 18.089l-7.165 3.583A.75.75 0 013.75 21V5.507c0-1.47 1.073-2.756 2.57-2.93z" />
                                  </svg>
                                )}
                              </span>
                            : fmtField(col.key, row[col.key])
                          }
                        </td>
                      ))}
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function SavePresetModal({ filters, sortField, sortDir, onSave, onClose }) {
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    try {
      await onSave(name.trim())
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#13131a] border border-white/10 rounded-2xl p-6 w-80 shadow-xl">
        <h3 className="text-sm font-semibold text-white mb-4">Save Screener Preset</h3>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          placeholder="e.g. My Value Screen"
          autoFocus
          className="w-full bg-white/5 border border-white/10 rounded-xl text-sm text-white px-3 py-2
                     focus:outline-none focus:ring-1 focus:ring-indigo-500/50 placeholder-gray-700 mb-4"
        />
        <p className="text-xs text-gray-600 mb-4">{filters.length} filter{filters.length !== 1 ? "s" : ""}, sorted by {sortField} ({sortDir})</p>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2 rounded-xl text-sm text-gray-400 border border-white/8 hover:text-white transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="flex-1 px-3 py-2 rounded-xl text-sm font-medium bg-indigo-600 hover:bg-indigo-500
                       text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ScreenerPage() {
  const navigate = useNavigate()

  const [filters, setFilters] = useState([])
  const [results, setResults] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [hasRun, setHasRun] = useState(false)
  const [sortField, setSortField] = useState("market_cap")
  const [sortDir, setSortDir] = useState("desc")
  const [globalPresets, setGlobalPresets] = useState([])
  const [userPresets, setUserPresets] = useState([])
  const [fieldMeta, setFieldMeta] = useState([])
  const [screenerStatus, setScreenerStatus] = useState(null)
  const [activePresetId, setActivePresetId] = useState(null)
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [planTickers, setPlanTickers] = useState(new Set())
  const PAGE_SIZE = 50

  // On mount: single request returns fields + status + presets in one round-trip
  useEffect(() => {
    apiFetch("/api/screener/init").then((data) => {
      setFieldMeta(data.fields || [])
      setGlobalPresets(data.global || [])
      setUserPresets(data.user || [])
      setScreenerStatus({ available: data.available, phase1_count: data.phase1_count })
    }).catch(() => {})
    apiFetch("/api/plans/tickers").then(d => setPlanTickers(new Set(d.tickers || []))).catch(() => {})
  }, [])

  const runScreener = useCallback(async (currentPage = 1, currentFilters = filters, sf = sortField, sd = sortDir) => {
    setLoading(true)
    setHasRun(true)
    try {
      const data = await apiFetch("/api/screener/run", {
        method: "POST",
        body: JSON.stringify({
          filters: currentFilters,
          sort_field: sf,
          sort_dir: sd,
          page: currentPage,
          page_size: PAGE_SIZE,
        }),
      })
      setResults(data.results || [])
      setTotal(data.total || 0)
      setPage(currentPage)
    } catch (e) {
      console.error("Screener run failed:", e)
    } finally {
      setLoading(false)
    }
  }, [filters, sortField, sortDir])

  function handleSort(field) {
    const newDir = sortField === field && sortDir === "desc" ? "asc" : "desc"
    setSortField(field)
    setSortDir(newDir)
    if (hasRun) runScreener(1, filters, field, newDir)
  }

  function handlePage(newPage) {
    runScreener(newPage, filters, sortField, sortDir)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  function addFilter() {
    if (fieldMeta.length === 0) return
    const defaultField = fieldMeta[0]
    const defaultOp = defaultField.type === "boolean" ? "eq" : "lte"
    const defaultVal = defaultField.type === "boolean" ? true : ""
    setFilters([...filters, { id: crypto.randomUUID(), field: defaultField.key, op: defaultOp, value: defaultVal }])
    setActivePresetId(null)
  }

  function loadPreset(preset) {
    setFilters(
      (preset.filters || []).map((f) => ({ ...f, id: crypto.randomUUID() }))
    )
    setSortField(preset.sort_field || "market_cap")
    setSortDir(preset.sort_dir || "desc")
    setActivePresetId(preset.id)
    runScreener(
      1,
      (preset.filters || []).map((f) => ({ ...f, id: crypto.randomUUID() })),
      preset.sort_field || "market_cap",
      preset.sort_dir || "desc",
    )
  }

  async function savePreset(name) {
    const data = await apiFetch("/api/screener/presets", {
      method: "POST",
      body: JSON.stringify({ name, filters, sort_field: sortField, sort_dir: sortDir }),
    })
    setUserPresets((prev) => [data, ...prev])
    setActivePresetId(data.id)
  }

  async function deletePreset(id) {
    await apiFetch(`/api/screener/presets/${id}`, { method: "DELETE" })
    setUserPresets((prev) => prev.filter((p) => p.id !== id))
    if (activePresetId === id) setActivePresetId(null)
  }

  const allPresets = [...globalPresets, ...userPresets]

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-white">Stock Screener</h1>
          <ScreenerStatus status={screenerStatus} />
        </div>
        <div className="flex items-center gap-2">
          {filters.length > 0 && (
            <button
              onClick={() => setShowSaveModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs text-gray-400
                         border border-white/8 hover:text-white hover:bg-white/[0.04] transition"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
              </svg>
              Save preset
            </button>
          )}
          <button
            onClick={() => runScreener(1)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                       bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20
                       disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {loading ? (
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
            )}
            Run Screener
          </button>
        </div>
      </div>

      {/* Presets row */}
      {allPresets.length > 0 && (
        <div className="mb-4">
          <p className="text-[10px] font-medium text-gray-700 uppercase tracking-wider mb-2">Presets</p>
          <div className="flex flex-wrap gap-2">
            {globalPresets.map((p) => (
              <PresetPill
                key={p.id}
                preset={p}
                active={activePresetId === p.id}
                onClick={() => loadPreset(p)}
                isUser={false}
              />
            ))}
            {userPresets.length > 0 && globalPresets.length > 0 && (
              <div className="w-px bg-white/10 self-stretch mx-1" />
            )}
            {userPresets.map((p) => (
              <PresetPill
                key={p.id}
                preset={p}
                active={activePresetId === p.id}
                onClick={() => loadPreset(p)}
                onDelete={deletePreset}
                isUser={true}
              />
            ))}
          </div>
        </div>
      )}

      {/* Filter builder */}
      <div className="bg-white/[0.02] border border-white/8 rounded-2xl p-4 mb-2">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-medium text-gray-500">Filters</p>
          {filters.length > 0 && (
            <button
              onClick={() => { setFilters([]); setActivePresetId(null) }}
              className="text-xs text-gray-600 hover:text-rose-400 transition"
            >
              Clear all
            </button>
          )}
        </div>

        {filters.length === 0 ? (
          <p className="text-xs text-gray-700 py-2">No filters — results show all stocks sorted by market cap.</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {filters.map((f) => (
              <FilterRow
                key={f.id}
                filter={f}
                fieldMeta={fieldMeta}
                onChange={(updated) => setFilters(filters.map((x) => x.id === f.id ? updated : x))}
                onRemove={() => setFilters(filters.filter((x) => x.id !== f.id))}
              />
            ))}
          </div>
        )}

        <button
          onClick={addFilter}
          disabled={fieldMeta.length === 0}
          className="mt-3 flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300
                     disabled:text-gray-700 disabled:cursor-not-allowed transition"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add filter
        </button>
      </div>

      {/* Results */}
      {hasRun && (
        <ResultsTable
          results={results}
          total={total}
          page={page}
          pageSize={PAGE_SIZE}
          sortField={sortField}
          sortDir={sortDir}
          loading={loading}
          onSort={handleSort}
          onPage={handlePage}
          onRowClick={(ticker) => navigate(`/app/stock/${ticker}`)}
          planTickers={planTickers}
        />
      )}

      {!hasRun && (
        <div className="bg-white/[0.02] border border-white/8 rounded-2xl p-10 text-center mt-4">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25"
            className="w-8 h-8 text-gray-700 mx-auto mb-3">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
          </svg>
          <p className="text-gray-600 text-sm">Select a preset or add filters, then run the screener.</p>
        </div>
      )}

      {/* Save preset modal */}
      {showSaveModal && (
        <SavePresetModal
          filters={filters}
          sortField={sortField}
          sortDir={sortDir}
          onSave={savePreset}
          onClose={() => setShowSaveModal(false)}
        />
      )}
    </div>
  )
}
