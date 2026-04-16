import { useState, useEffect, useRef } from "react"
import { Link } from "react-router-dom"
import { auth } from "../firebase"

async function getToken() {
  try { return await auth.currentUser?.getIdToken() } catch { return null }
}

async function apiFetch(path, opts = {}) {
  const token = await getToken()
  const res = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Server error ${res.status}`)
  }
  return res.json()
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10)
}

function daysDiff(from, to) {
  const a = new Date(from), b = new Date(to)
  return Math.max(0, Math.round((b - a) / 86400000))
}

const MONTH_MAP = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'}

function saxoDateToISO(s) {
  if (!s) return ""
  const [d, m, y] = s.split('-')
  return `${y}-${MONTH_MAP[m]}-${d.padStart(2, '0')}`
}

function isWithinTwoMonths(isoDate) {
  if (!isoDate) return false
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() + 2)
  return new Date(isoDate) <= cutoff
}

function fmt(val, decimals = 2) {
  if (val === null || val === undefined || isNaN(val)) return "—"
  return Number(val).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function positionTicker(p) {
  if (p.asset_type === "Stock Option") {
    return p.symbol?.split("/")[0]?.replace("_US", "") ?? ""
  }
  const parts = (p.symbol || "").split(":")
  const base = parts[0]
  const suffix = (parts[1] || "").toLowerCase()
  if (suffix === "xhkg") return ((base.replace(/^0+/, "") || "0").padStart(4, "0")) + ".HK"
  if (suffix === "xses") return base + ".SI"
  return base
}

function formatMonth(isoYM) {
  const [y, m] = isoYM.split('-')
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${names[parseInt(m, 10) - 1]} ${y}`
}

function computeRow(row) {
  const { strike, premium, units, entry_date, expiry } = row
  const cash_aside = units * 100 * strike
  const earnings = premium * 100 * units
  const tenor = daysDiff(entry_date, expiry)
  const return_pct = cash_aside > 0 ? (earnings / cash_aside) * 100 : 0
  const arr_pct = tenor > 0 ? (return_pct / tenor) * 365 : 0
  return { cash_aside, earnings, tenor, return_pct, arr_pct }
}

// ── Badge components ──────────────────────────────────────────────────────────

function TypeBadge({ type }) {
  const styles = {
    "Covered Call":    "bg-sky-500/15 text-sky-400 border-sky-500/20",
    "Cash Secured Put": "bg-violet-500/15 text-violet-400 border-violet-500/20",
  }
  const labels = { "Covered Call": "CC", "Cash Secured Put": "CSP" }
  const cls = styles[type]
  if (!cls) return null
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${cls}`}>
      {labels[type]}
    </span>
  )
}

// ── Ticker search ─────────────────────────────────────────────────────────────

function TickerSearch({ value, onChange, onSelect }) {
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const debounce = useRef(null)
  const containerRef = useRef(null)

  const search = (q) => {
    onChange(q)
    clearTimeout(debounce.current)
    if (!q.trim()) { setResults([]); setOpen(false); return }
    debounce.current = setTimeout(async () => {
      try {
        const data = await apiFetch(`/api/tickers/search?q=${encodeURIComponent(q)}`)
        setResults(data.results || [])
        setOpen(true)
      } catch { setResults([]) }
    }, 250)
  }

  const select = (item) => {
    onChange(item.symbol)
    setOpen(false)
    setResults([])
    onSelect(item.symbol)
  }

  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  return (
    <div className="relative" ref={containerRef}>
      <input
        type="text"
        value={value}
        onChange={(e) => search(e.target.value)}
        placeholder="e.g. AAPL"
        className="w-36 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
      />
      {open && results.length > 0 && (
        <ul className="absolute top-full mt-1 left-0 z-50 w-56 bg-[#111117] border border-white/10 rounded-xl shadow-xl overflow-hidden">
          {results.slice(0, 8).map((r) => (
            <li
              key={r.symbol}
              onMouseDown={() => select(r)}
              className="px-3 py-2 text-sm cursor-pointer hover:bg-white/[0.05] flex items-center justify-between"
            >
              <span className="font-medium text-white">{r.symbol}</span>
              <span className="text-gray-500 text-xs truncate ml-2">{r.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Add position form ─────────────────────────────────────────────────────────

function AddForm({ optionType, onAdd, onCancel, initialTicker = "" }) {
  const [ticker, setTicker] = useState(initialTicker)
  const [expiries, setExpiries] = useState([])
  const [expiry, setExpiry] = useState("")
  const [strikes, setStrikes] = useState([])
  const [strike, setStrike] = useState("")
  const [contractData, setContractData] = useState(null)
  const [entryDate, setEntryDate] = useState(today())
  const [units, setUnits] = useState(1)
  const [loadingExpiries, setLoadingExpiries] = useState(false)
  const [loadingStrikes, setLoadingStrikes] = useState(false)
  const [loadingContract, setLoadingContract] = useState(false)
  const [error, setError] = useState("")
  const [underlyingPrice, setUnderlyingPrice] = useState(null)

  const onTickerSelect = async (sym) => {
    setExpiry(""); setStrikes([]); setStrike(""); setContractData(null); setError(""); setUnderlyingPrice(null)
    setLoadingExpiries(true)
    try {
      const data = await apiFetch(`/api/options/expiries?ticker=${sym}`)
      setExpiries(data.expiries || [])
      setUnderlyingPrice(data.current_price ?? null)
    } catch (e) {
      setError(`Could not fetch expiries: ${e.message}`)
    } finally {
      setLoadingExpiries(false)
    }
  }

  // Auto-fetch expiries when pre-filled with a ticker from "Plan Cover"
  useEffect(() => {
    if (initialTicker) onTickerSelect(initialTicker)
  }, [])

  const onExpiryChange = async (e) => {
    const val = e.target.value
    setExpiry(val); setStrikes([]); setStrike(""); setContractData(null); setError("")
    if (!val) return
    setLoadingStrikes(true)
    try {
      const data = await apiFetch(`/api/options/strikes?ticker=${ticker}&expiry=${val}&option_type=${optionType}`)
      setStrikes(data.strikes || [])
    } catch (e) {
      setError(`Could not fetch strikes: ${e.message}`)
    } finally {
      setLoadingStrikes(false)
    }
  }

  const onStrikeChange = async (e) => {
    const val = e.target.value
    setStrike(val); setContractData(null); setError("")
    if (!val) return
    setLoadingContract(true)
    try {
      const data = await apiFetch(
        `/api/options/contract?ticker=${ticker}&expiry=${expiry}&strike=${val}&option_type=${optionType}`
      )
      setContractData(data)
    } catch (e) {
      setError(`Could not fetch contract: ${e.message}`)
    } finally {
      setLoadingContract(false)
    }
  }

  const canAdd = ticker && expiry && strike && contractData?.premium != null && units >= 1

  const handleAdd = () => {
    onAdd({
      id: crypto.randomUUID(),
      ticker,
      expiry,
      strike: parseFloat(strike),
      premium: contractData.premium,
      entry_date: entryDate,
      units: parseInt(units),
      locked: false,
    })
  }

  const computed = canAdd ? computeRow({
    strike: parseFloat(strike),
    premium: contractData.premium,
    units: parseInt(units),
    entry_date: entryDate,
    expiry,
  }) : null

  const inputCls = "bg-[#1a1a2e] border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500/50 disabled:opacity-40"

  return (
    <div className="mb-4 p-4 rounded-2xl border border-indigo-500/20 bg-indigo-500/[0.04]">
      <p className="text-xs font-medium text-indigo-300 mb-3">New position</p>
      <div className="flex flex-wrap gap-3 items-end">

        {/* Ticker */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">Ticker</label>
          <TickerSearch value={ticker} onChange={setTicker} onSelect={onTickerSelect} />
          <p className="text-xs text-gray-500 h-4">
            {underlyingPrice != null && <>Current: <span className="text-white font-medium">${fmt(underlyingPrice, 2)}</span></>}
          </p>
        </div>

        {/* Expiry */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">Expiry</label>
          <select
            value={expiry}
            onChange={onExpiryChange}
            disabled={!expiries.length}
            className={`w-36 ${inputCls}`}
          >
            <option value="">{loadingExpiries ? "Loading…" : "Select expiry"}</option>
            {expiries.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>

        {/* Strike */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">Strike</label>
          <select
            value={strike}
            onChange={onStrikeChange}
            disabled={!strikes.length}
            className={`w-28 ${inputCls}`}
          >
            <option value="">{loadingStrikes ? "Loading…" : "Strike"}</option>
            {strikes.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Premium */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">Premium</label>
          <div className={`w-32 ${inputCls} flex items-center gap-1 opacity-100`}>
            {loadingContract ? (
              <span className="text-gray-500">Loading…</span>
            ) : contractData ? (
              <>
                <span className="text-white">${fmt(contractData.premium)}</span>
                <span className="text-[10px] text-gray-600">({contractData.premium_source})</span>
              </>
            ) : (
              <span className="text-gray-600">—</span>
            )}
          </div>
        </div>

        {/* Entry date */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">Entry Date</label>
          <input
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            className={`w-36 ${inputCls}`}
          />
        </div>

        {/* Units */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">Units</label>
          <input
            type="number"
            min="1"
            value={units}
            onChange={(e) => setUnits(Math.max(1, parseInt(e.target.value) || 1))}
            className={`w-20 ${inputCls} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
          />
        </div>

        {/* Computed preview */}
        {computed && (
          <div className="flex gap-4 items-end pb-0.5 text-xs text-gray-400 border-l border-white/8 pl-4">
            <div><span className="text-gray-600">Cash Aside </span>${fmt(computed.cash_aside, 0)}</div>
            <div><span className="text-gray-600">Earnings </span>${fmt(computed.earnings, 0)}</div>
            <div><span className="text-gray-600">Return </span>{fmt(computed.return_pct, 2)}%</div>
            <div><span className="text-gray-600">ARR </span>{fmt(computed.arr_pct, 2)}%</div>
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-2 ml-auto">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/[0.04] transition"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={!canAdd}
            className="px-4 py-1.5 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add
          </button>
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
    </div>
  )
}

// ── Lock modal ────────────────────────────────────────────────────────────────

function LockModal({ row, onConfirm, onCancel }) {
  const [entryDate, setEntryDate] = useState(row.entry_date)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#111117] border border-white/10 rounded-2xl p-6 w-80 shadow-2xl">
        <h3 className="text-sm font-semibold text-white mb-1">Lock position</h3>
        <p className="text-xs text-gray-500 mb-4">
          Confirm your entry date. Once locked, this row cannot be edited.
        </p>
        <div className="mb-4">
          <label className="text-[10px] text-gray-500 uppercase tracking-wider block mb-1">Entry Date</label>
          <input
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
          />
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/[0.04] transition"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(entryDate)}
            className="px-4 py-1.5 text-sm rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium transition"
          >
            Confirm & Lock
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Table ─────────────────────────────────────────────────────────────────────

const BASE_COLS = [
  { key: "stock_name",  label: "Stock Name"  },
  { key: "strike",      label: "Strike"       },
  { key: "expiry",      label: "Expiry"       },
  { key: "premium",     label: "Premium"      },
  { key: "entry_date",  label: "Entry Date"   },
  { key: "units",       label: "Units"        },
  { key: "cash_aside",  label: "Cash Aside"   },
  { key: "earnings",    label: "Earnings"     },
  { key: "tenor",       label: "Tenor"        },
  { key: "return_pct",  label: "Return %"     },
  { key: "arr_pct",     label: "ARR %"        },
  { key: "locked",      label: "Locked"       },
  { key: "actions",     label: ""             },
]

function CyclingTable({ rows, showType, onEdit, onLock, onDelete, readOnly = false }) {
  const columns = showType
    ? [{ key: "type", label: "Type" }, ...BASE_COLS]
    : BASE_COLS

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/8">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/8 bg-white/[0.02]">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-3 text-[11px] font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap ${
                  col.key === "actions" ? "w-16" :
                  col.key === "locked"  ? "text-center" :
                  col.key === "type" || col.key === "stock_name" ? "text-left" : "text-right"
                }`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-16 text-center text-gray-600 text-sm">
                No positions yet
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const c = computeRow(row)
              return (
                <tr key={row.id} className="border-b border-white/5 hover:bg-white/[0.02] transition">
                  {showType && (
                    <td className="px-4 py-3">
                      <TypeBadge type={row.type} />
                    </td>
                  )}

                  {/* Stock Name */}
                  <td className="px-4 py-3 font-medium text-white">
                    <Link to={`/app/stock/${row.ticker}`} className="hover:text-indigo-300 transition-colors">{row.ticker}</Link>
                  </td>

                  {/* Strike */}
                  <td className="px-4 py-3 text-right text-gray-300">{fmt(row.strike, 2)}</td>

                  {/* Expiry */}
                  <td className="px-4 py-3 text-right text-gray-300 whitespace-nowrap">{row.expiry}</td>

                  {/* Premium */}
                  <td className="px-4 py-3 text-right text-gray-300">${fmt(row.premium)}</td>

                  {/* Entry Date */}
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {row.locked || readOnly ? (
                      <span className="text-gray-300">{row.entry_date}</span>
                    ) : (
                      <input
                        type="date"
                        value={row.entry_date}
                        onChange={(e) => onEdit(row.id, "entry_date", e.target.value)}
                        className="bg-transparent border border-white/10 rounded-lg px-2 py-0.5 text-sm text-gray-300 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                      />
                    )}
                  </td>

                  {/* Units */}
                  <td className="px-4 py-3 text-right">
                    {row.locked || readOnly ? (
                      <span className="text-gray-300">{row.units}</span>
                    ) : (
                      <input
                        type="number"
                        min="1"
                        value={row.units}
                        onChange={(e) => onEdit(row.id, "units", Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-16 bg-transparent border border-white/10 rounded-lg px-2 py-0.5 text-sm text-gray-300 text-right focus:outline-none focus:ring-1 focus:ring-indigo-500/50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                    )}
                  </td>

                  {/* Cash Aside */}
                  <td className="px-4 py-3 text-right text-gray-300">${fmt(c.cash_aside, 0)}</td>

                  {/* Earnings */}
                  <td className="px-4 py-3 text-right text-emerald-400">${fmt(c.earnings, 0)}</td>

                  {/* Tenor */}
                  <td className="px-4 py-3 text-right text-gray-300">{c.tenor}d</td>

                  {/* Return % */}
                  <td className="px-4 py-3 text-right text-gray-300">{fmt(c.return_pct, 2)}%</td>

                  {/* ARR % */}
                  <td className="px-4 py-3 text-right font-medium text-indigo-300">{fmt(c.arr_pct, 2)}%</td>

                  {/* Locked */}
                  <td className="px-4 py-3 text-center">
                    {row.locked || readOnly ? (
                      <svg viewBox="0 0 24 24" fill="currentColor" className={`w-4 h-4 mx-auto ${row.locked ? "text-emerald-400" : "text-gray-600"}`}>
                        <path fillRule="evenodd" d="M12 1.5a5.25 5.25 0 00-5.25 5.25v3a3 3 0 00-3 3v6.75a3 3 0 003 3h10.5a3 3 0 003-3v-6.75a3 3 0 00-3-3v-3A5.25 5.25 0 0012 1.5zm3.75 8.25v-3a3.75 3.75 0 10-7.5 0v3h7.5z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <button
                        onClick={() => onLock(row)}
                        title="Lock position"
                        className="mx-auto flex text-amber-500 hover:text-amber-400 transition"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-4 h-4">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                        </svg>
                      </button>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3 text-center">
                    {!readOnly && (
                      <button
                        onClick={() => onDelete(row.id)}
                        title="Delete"
                        className="text-gray-600 hover:text-rose-400 transition"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-4 h-4">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                      </button>
                    )}
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
        {rows.length > 0 && (() => {
          const computed = rows.map((r) => computeRow(r))
          const totalUnits     = rows.reduce((s, r) => s + r.units, 0)
          const totalCashAside = computed.reduce((s, c) => s + c.cash_aside, 0)
          const totalEarnings  = computed.reduce((s, c) => s + c.earnings, 0)
          const wavgTenor      = totalCashAside > 0
            ? computed.reduce((s, c, i) => s + c.tenor * (c.cash_aside / totalCashAside), 0)
            : 0
          const totalReturn    = totalCashAside > 0 ? (totalEarnings / totalCashAside) * 100 : 0
          const totalArr       = wavgTenor > 0 ? (totalReturn / wavgTenor) * 365 : 0
          const extraCol       = showType ? 1 : 0

          return (
            <tfoot>
              <tr className="border-t-2 border-white/10 bg-white/[0.03] font-semibold text-sm">
                {showType && <td className="px-4 py-3" />}
                <td className="px-4 py-3 text-white">Total</td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3 text-right text-white">{totalUnits}</td>
                <td className="px-4 py-3 text-right text-white">${fmt(totalCashAside, 0)}</td>
                <td className="px-4 py-3 text-right text-emerald-400">${fmt(totalEarnings, 0)}</td>
                <td className="px-4 py-3 text-right text-white">{fmt(wavgTenor, 1)}d</td>
                <td className="px-4 py-3 text-right text-white">{fmt(totalReturn, 2)}%</td>
                <td className="px-4 py-3 text-right text-indigo-300">{fmt(totalArr, 2)}%</td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
              </tr>
            </tfoot>
          )
        })()}
      </table>
    </div>
  )
}

// ── Monthly breakdown ─────────────────────────────────────────────────────────

function MonthlyBreakdown({ title, rows, fxRate }) {
  const byMonth = {}
  for (const row of rows) {
    const month = row.expiry?.slice(0, 7)
    if (!month) continue
    if (!byMonth[month]) byMonth[month] = []
    byMonth[month].push(row)
  }

  // Always show current month + next 2, regardless of data
  const months = []
  const cursor = new Date()
  for (let i = 0; i < 3; i++) {
    const y = cursor.getFullYear()
    const m = String(cursor.getMonth() + 1).padStart(2, '0')
    months.push(`${y}-${m}`)
    cursor.setMonth(cursor.getMonth() + 1)
  }

  const totals = { earnings: 0, cashAside: 0, stockAside: 0 }

  const monthData = months.map((month) => {
    const mrs = byMonth[month] || []
    const earnings   = mrs.reduce((s, r) => s + computeRow(r).earnings, 0)
    const cashAside  = mrs.filter(r => r.type === "Cash Secured Put").reduce((s, r) => s + computeRow(r).cash_aside, 0)
    const stockAside = mrs.filter(r => r.type === "Covered Call").reduce((s, r) => s + computeRow(r).cash_aside, 0)
    totals.earnings   += earnings
    totals.cashAside  += cashAside
    totals.stockAside += stockAside
    return { month, earnings, cashAside, stockAside }
  })

  const thCls = "px-4 py-2.5 text-right text-[11px] font-medium text-gray-500 uppercase tracking-wider"

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{title}</h3>
      <div className="overflow-x-auto rounded-xl border border-white/8">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/8 bg-white/[0.02]">
              <th className="px-4 py-2.5 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wider">Month</th>
              <th className={thCls}>Earnings (USD)</th>
              <th className={thCls}>Earnings (SGD)</th>
              <th className={thCls}>Cash Aside</th>
              <th className={thCls}>Stock Aside</th>
            </tr>
          </thead>
          <tbody>
            {monthData.map(({ month, earnings, cashAside, stockAside }) => (
              <tr key={month} className="border-b border-white/5 hover:bg-white/[0.02] transition">
                <td className="px-4 py-2.5 text-gray-300 font-medium">{formatMonth(month)}</td>
                <td className="px-4 py-2.5 text-right text-emerald-400">${fmt(earnings, 0)}</td>
                <td className="px-4 py-2.5 text-right text-emerald-300">
                  {fxRate ? `S$${fmt(earnings * fxRate, 0)}` : "—"}
                </td>
                <td className="px-4 py-2.5 text-right text-violet-400">${fmt(cashAside, 0)}</td>
                <td className="px-4 py-2.5 text-right text-sky-400">${fmt(stockAside, 0)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-white/10 bg-white/[0.03] font-semibold">
              <td className="px-4 py-2.5 text-white text-sm">Total</td>
              <td className="px-4 py-2.5 text-right text-emerald-400">${fmt(totals.earnings, 0)}</td>
              <td className="px-4 py-2.5 text-right text-emerald-300">
                {fxRate ? `S$${fmt(totals.earnings * fxRate, 0)}` : "—"}
              </td>
              <td className="px-4 py-2.5 text-right text-violet-400">${fmt(totals.cashAside, 0)}</td>
              <td className="px-4 py-2.5 text-right text-sky-400">${fmt(totals.stockAside, 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// ── Uncovered calls table ─────────────────────────────────────────────────────

function UncoveredCallsTable({ rows, loading, onPlanCover }) {
  const thCls = "px-4 py-3 text-[11px] font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
  return (
    <div className="mt-8">
      <h2 className="text-sm font-semibold text-gray-300 mb-3">Uncovered Positions</h2>
      <div className="overflow-x-auto rounded-2xl border border-white/8">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/8 bg-white/[0.02]">
              <th className={`${thCls} text-left`}>Ticker</th>
              <th className={`${thCls} text-right`}>Long Calls</th>
              <th className={`${thCls} text-right`}>Long Stock</th>
              <th className={`${thCls} text-right`}>Total Long</th>
              <th className={`${thCls} text-right`}>Calls Sold</th>
              <th className={`${thCls} text-right`}>Net Uncovered</th>
              <th className={`${thCls} text-right`}>Value Uncovered</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-600 text-sm">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-600 text-sm">No uncovered positions found</td></tr>
            ) : rows.map(r => (
              <tr key={r.ticker} className="border-b border-white/5 hover:bg-white/[0.02] transition">
                <td className="px-4 py-3 font-medium text-white">{r.ticker}</td>
                <td className="px-4 py-3 text-right text-gray-300">{r.longCalls}</td>
                <td className="px-4 py-3 text-right text-gray-300">{r.longStock}</td>
                <td className="px-4 py-3 text-right text-gray-300">{r.longCalls + r.longStock}</td>
                <td className="px-4 py-3 text-right text-rose-400">{r.sold}</td>
                <td className="px-4 py-3 text-right font-semibold text-emerald-400">{r.net}</td>
                <td className="px-4 py-3 text-right text-gray-300">${fmt(r.valueUncovered, 0)}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => onPlanCover(r.ticker)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition shadow-lg shadow-indigo-500/20 whitespace-nowrap"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Sell Cover
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const TABS = ["Consolidated View", "Covered Calls", "Cash Secured Puts"]

export default function OptionsCyclingPage() {
  const [activeTab, setActiveTab] = useState(0)
  const [cspRows, setCspRows] = useState([])
  const [ccRows, setCcRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [lockModal, setLockModal] = useState(null)  // row being locked
  const [usdSgdRate, setUsdSgdRate] = useState(null)
  const [uncoveredCalls, setUncoveredCalls] = useState([])
  const [loadingUncovered, setLoadingUncovered] = useState(false)
  const [planCoverTicker, setPlanCoverTicker] = useState("")

  const loadUncoveredCalls = async (currentCcRows) => {
    setLoadingUncovered(true)
    try {
      const data = await apiFetch("/api/portfolio")
      const positions = data.positions || []

      const longByTicker = {}
      for (const p of positions) {
        if (p.l_s !== "Long") continue
        const ticker = positionTicker(p)
        if (!ticker) continue
        if (!longByTicker[ticker]) longByTicker[ticker] = { calls: 0, stock: 0, callValue: 0, stockValue: 0 }
        if (p.asset_type === "Stock Option" && p.call_put === "Call") {
          const qty = Math.abs(p.quantity || 0)
          longByTicker[ticker].calls += qty
          longByTicker[ticker].callValue += qty * (p.strike || 0) * 100
        } else if (p.asset_type !== "Stock Option") {
          const qty = Math.abs(p.quantity || 0)
          const contracts = Math.floor(qty / 100)
          longByTicker[ticker].stock += contracts
          longByTicker[ticker].stockValue += qty * (p.current_price || 0)
        }
      }

      const shortByTicker = {}
      // From CC rows (manually added / imported)
      for (const row of currentCcRows) {
        shortByTicker[row.ticker] = true
      }
      // Also from portfolio directly — catches short calls with any expiry, not just <2mo
      for (const p of positions) {
        if (p.asset_type === "Stock Option" && p.call_put === "Call" && p.l_s === "Short") {
          const ticker = positionTicker(p)
          if (ticker) shortByTicker[ticker] = true
        }
      }

      const candidates = []
      for (const [ticker, { calls, stock, callValue, stockValue }] of Object.entries(longByTicker)) {
        if (calls + stock === 0) continue
        // If any sold call exists on this ticker (any expiry), exclude it entirely
        if (shortByTicker[ticker]) continue
        candidates.push({ ticker, longCalls: calls, longStock: stock, sold: 0, net: calls + stock, valueUncovered: callValue + stockValue })
      }

      const result = candidates
        .filter(c => {
          const rep = positions.find(p => positionTicker(p) === c.ticker)
          return rep?.has_options === true
        })
        .sort((a, b) => b.net - a.net)

      setUncoveredCalls(result)
    } catch (e) {
      console.error("loadUncoveredCalls:", e)
    } finally {
      setLoadingUncovered(false)
    }
  }

  // Load on mount
  useEffect(() => {
    apiFetch("/api/cycling")
      .then((data) => {
        const csp = data.cash_secured_puts || []
        const cc = data.covered_calls || []
        setCspRows(csp)
        setCcRows(cc)
        loadUncoveredCalls(cc)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
    apiFetch("/api/fx/usdsgd")
      .then((data) => { if (data.rate) setUsdSgdRate(data.rate) })
      .catch(() => {})
  }, [])

  const saveAll = async (newCsp, newCc) => {
    try {
      await apiFetch("/api/cycling", {
        method: "POST",
        body: JSON.stringify({ cash_secured_puts: newCsp, covered_calls: newCc }),
      })
    } catch (e) {
      console.error("Failed to save:", e)
    }
  }

  // CSP handlers
  const handleCspAdd = (row) => {
    const updated = [...cspRows, row]
    setCspRows(updated)
    setAdding(false)
    saveAll(updated, ccRows)
  }

  const handleCspEdit = (id, field, value) => {
    const updated = cspRows.map((r) => r.id === id ? { ...r, [field]: value } : r)
    setCspRows(updated)
    saveAll(updated, ccRows)
  }

  const handleCspDelete = (id) => {
    const updated = cspRows.filter((r) => r.id !== id)
    setCspRows(updated)
    saveAll(updated, ccRows)
  }

  const handleCspLock = (row) => setLockModal({ ...row, _list: "csp" })

  const importCspFromPortfolio = async () => {
    const data = await apiFetch("/api/portfolio")
    const positions = data.positions || []

    const shortPuts = positions.filter(p =>
      p.asset_type === "Stock Option" &&
      p.call_put === "Put" &&
      p.l_s === "Short" &&
      p.expiry &&
      isWithinTwoMonths(saxoDateToISO(p.expiry))
    )

    const existing = new Set(cspRows.map(r => `${r.ticker}|${r.expiry}|${r.strike}`))

    const newRows = shortPuts
      .filter(p => {
        const ticker = p.symbol?.split("/")[0]?.replace("_US", "") ?? ""
        const expiry = saxoDateToISO(p.expiry)
        return !existing.has(`${ticker}|${expiry}|${p.strike}`)
      })
      .map(p => ({
        id: crypto.randomUUID(),
        ticker: p.symbol?.split("/")[0]?.replace("_US", "") ?? "",
        expiry: saxoDateToISO(p.expiry),
        strike: p.strike ?? 0,
        premium: Math.abs(p.open_price ?? 0),
        entry_date: saxoDateToISO(p.value_date),
        units: Math.abs(p.quantity ?? 0),
        locked: true,
      }))

    if (newRows.length === 0) return

    const updated = [...cspRows, ...newRows]
    setCspRows(updated)
    saveAll(updated, ccRows)
  }

  // CC handlers
  const handleCcAdd = (row) => {
    const updated = [...ccRows, row]
    setCcRows(updated)
    setAdding(false)
    saveAll(cspRows, updated)
    loadUncoveredCalls(updated)
  }

  const handleCcEdit = (id, field, value) => {
    const updated = ccRows.map((r) => r.id === id ? { ...r, [field]: value } : r)
    setCcRows(updated)
    saveAll(cspRows, updated)
  }

  const handleCcDelete = (id) => {
    const updated = ccRows.filter((r) => r.id !== id)
    setCcRows(updated)
    saveAll(cspRows, updated)
    loadUncoveredCalls(updated)
  }

  const handleCcLock = (row) => setLockModal({ ...row, _list: "cc" })

  const importFromPortfolio = async () => {
    const data = await apiFetch("/api/portfolio")
    const positions = data.positions || []

    const shortCalls = positions.filter(p =>
      p.asset_type === "Stock Option" &&
      p.call_put === "Call" &&
      p.l_s === "Short" &&
      p.expiry &&
      isWithinTwoMonths(saxoDateToISO(p.expiry))
    )

    const existing = new Set(ccRows.map(r => `${r.ticker}|${r.expiry}|${r.strike}`))

    const newRows = shortCalls
      .filter(p => {
        const ticker = p.symbol?.split("/")[0]?.replace("_US", "") ?? ""
        const expiry = saxoDateToISO(p.expiry)
        return !existing.has(`${ticker}|${expiry}|${p.strike}`)
      })
      .map(p => ({
        id: crypto.randomUUID(),
        ticker: p.symbol?.split("/")[0]?.replace("_US", "") ?? "",
        expiry: saxoDateToISO(p.expiry),
        strike: p.strike ?? 0,
        premium: Math.abs(p.open_price ?? 0),
        entry_date: saxoDateToISO(p.value_date),
        units: Math.abs(p.quantity ?? 0),
        locked: true,
      }))

    if (newRows.length === 0) return

    const updated = [...ccRows, ...newRows]
    setCcRows(updated)
    saveAll(cspRows, updated)
  }

  const confirmLock = (entryDate) => {
    if (lockModal._list === "cc") {
      const updated = ccRows.map((r) =>
        r.id === lockModal.id ? { ...r, locked: true, entry_date: entryDate } : r
      )
      setCcRows(updated)
      setLockModal(null)
      saveAll(cspRows, updated)
    } else {
      const updated = cspRows.map((r) =>
        r.id === lockModal.id ? { ...r, locked: true, entry_date: entryDate } : r
      )
      setCspRows(updated)
      setLockModal(null)
      saveAll(updated, ccRows)
    }
  }

  const consolidated = [
    ...ccRows.map((r) => ({ ...r, type: "Covered Call" })),
    ...cspRows.map((r) => ({ ...r, type: "Cash Secured Put" })),
  ]

  const isCspTab = activeTab === 2
  const isCcTab  = activeTab === 1

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      {/* Lock modal */}
      {lockModal && (
        <LockModal
          row={lockModal}
          onConfirm={confirmLock}
          onCancel={() => setLockModal(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white">Options Wheeling</h1>
          <p className="text-sm text-gray-500 mt-1">Track your covered calls and cash-secured puts</p>
        </div>
        {(isCspTab || isCcTab) && !adding && (
          <div className="flex gap-2">
            {(isCcTab || isCspTab) && (
              <button
                onClick={isCcTab ? importFromPortfolio : importCspFromPortfolio}
                className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl border border-white/10 text-gray-300 hover:bg-white/[0.04] transition"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Import from Portfolio
              </button>
            )}
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition shadow-lg shadow-indigo-500/20"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add Position
            </button>
          </div>
        )}
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 mb-6 bg-white/[0.03] border border-white/8 rounded-xl p-1 w-fit">
        {TABS.map((tab, i) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(i); setAdding(false) }}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
              activeTab === i
                ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/25"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-600 text-sm">Loading…</div>
      ) : (
        <>
          {/* Add form */}
          {isCcTab && adding && (
            <AddForm
              optionType="call"
              initialTicker={planCoverTicker}
              onAdd={(row) => { setPlanCoverTicker(""); handleCcAdd(row) }}
              onCancel={() => { setPlanCoverTicker(""); setAdding(false) }}
            />
          )}
          {isCspTab && adding && (
            <AddForm
              optionType="put"
              onAdd={handleCspAdd}
              onCancel={() => setAdding(false)}
            />
          )}

          {/* Table */}
          {activeTab === 0 && (
            <>
              <div className="mb-6 grid grid-cols-2 gap-6">
                <MonthlyBreakdown
                  title="Confirmed Earnings"
                  rows={consolidated.filter(r => r.locked)}
                  fxRate={usdSgdRate}
                />
                <MonthlyBreakdown
                  title="Planned Earnings"
                  rows={consolidated}
                  fxRate={usdSgdRate}
                />
              </div>
              <CyclingTable
                rows={consolidated}
                showType
                readOnly
                onEdit={() => {}}
                onLock={() => {}}
                onDelete={() => {}}
              />
            </>
          )}
          {activeTab === 1 && (
            <>
              <CyclingTable
                rows={ccRows}
                showType={false}
                onEdit={handleCcEdit}
                onLock={handleCcLock}
                onDelete={handleCcDelete}
              />
              <UncoveredCallsTable
                rows={uncoveredCalls}
                loading={loadingUncovered}
                onPlanCover={(ticker) => { setPlanCoverTicker(ticker); setAdding(true) }}
              />
            </>
          )}
          {activeTab === 2 && (
            <CyclingTable
              rows={cspRows}
              showType={false}
              onEdit={handleCspEdit}
              onLock={handleCspLock}
              onDelete={handleCspDelete}
            />
          )}
        </>
      )}
    </div>
  )
}
