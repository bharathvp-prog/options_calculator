import { useState, useEffect, useRef } from "react"
import { auth } from "../firebase"

async function getToken() {
  try {
    return await auth.currentUser?.getIdToken()
  } catch {
    return null
  }
}

function fmtSGD(val) {
  if (val === null || val === undefined) return "—"
  const abs = Math.abs(val).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  return (val >= 0 ? "+" : "−") + "$" + abs
}

function pnlColor(val) {
  if (val === null || val === undefined) return "text-gray-500"
  if (val > 0) return "text-emerald-400"
  if (val < 0) return "text-rose-400"
  return "text-gray-500"
}

function fmtMonth(key) {
  // "2026-01" → "Jan 2026"
  const [year, month] = key.split("-")
  const d = new Date(Number(year), Number(month) - 1, 1)
  return d.toLocaleString("en-US", { month: "short", year: "numeric" })
}

export default function HistoricalPerformancePage() {
  const [data, setData] = useState({})         // { "YYYY-MM": { ... } }
  const [uploadedAt, setUploadedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState(null)
  const [skippedMonths, setSkippedMonths] = useState([])
  const [lockingMonth, setLockingMonth] = useState(null)
  const fileInputRef = useRef(null)

  async function fetchData() {
    try {
      const token = await getToken()
      const res = await fetch("/api/historical", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const json = await res.json()
      setData(json.historical_performance || {})
      setUploadedAt(json.uploaded_at)
    } catch {
      // silently ignore on load
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  async function handleUpload(file) {
    if (!file.name.endsWith(".xlsx")) {
      setError("Please upload a .xlsx file exported from Saxo Bank.")
      return
    }
    setError(null)
    setUploading(true)
    try {
      const token = await getToken()
      const formData = new FormData()
      formData.append("file", file)
      const res = await fetch("/api/historical/upload", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.detail || "Upload failed")
      setSkippedMonths(json.skipped_months || [])
      setUploadModalOpen(false)
      await fetchData()
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  async function toggleLock(month, currentLocked) {
    setLockingMonth(month)
    try {
      const token = await getToken()
      const res = await fetch("/api/historical/lock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ month, locked: !currentLocked }),
      })
      if (!res.ok) throw new Error("Lock update failed")
      setData(prev => ({
        ...prev,
        [month]: { ...prev[month], locked: !currentLocked },
      }))
    } catch (e) {
      setError(e.message)
    } finally {
      setLockingMonth(null)
    }
  }

  const sortedMonths = Object.keys(data).sort((a, b) => b.localeCompare(a))

  const handleDrop = (e) => {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleUpload(file)
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white">Historical Performance</h1>
          {uploadedAt && (
            <p className="text-xs text-white/40 mt-0.5">
              Last updated {new Date(uploadedAt).toLocaleString()}
            </p>
          )}
        </div>
        <button
          onClick={() => { setError(null); setUploadModalOpen(true) }}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl shadow-lg shadow-indigo-500/20 transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          Upload Statement
        </button>
      </div>

      {/* Skipped months warning */}
      {skippedMonths.length > 0 && (
        <div className="mb-4 flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-4 h-4 mt-0.5 shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span>
            <strong>{skippedMonths.length} locked {skippedMonths.length === 1 ? "month was" : "months were"} not updated:</strong>{" "}
            {skippedMonths.map(fmtMonth).join(", ")}
          </span>
          <button onClick={() => setSkippedMonths([])} className="ml-auto text-amber-400/60 hover:text-amber-400">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center h-64 text-white/40 text-sm">Loading…</div>
      ) : sortedMonths.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 gap-4 text-white/40">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-12 h-12 opacity-30">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
          </svg>
          <p className="text-sm">No performance data yet.</p>
          <button
            onClick={() => { setError(null); setUploadModalOpen(true) }}
            className="text-indigo-400 hover:text-indigo-300 text-sm underline underline-offset-2"
          >
            Upload your Saxo Bank statement
          </button>
        </div>
      ) : (
        <div className="bg-white/[0.02] border border-white/8 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8">
                <th className="text-left px-4 py-3 text-white/50 font-medium">Month</th>
                <th className="text-right px-4 py-3 text-white/50 font-medium">Total P&L</th>
                <th className="text-right px-4 py-3 text-white/50 font-medium">Realized</th>
                <th className="text-right px-4 py-3 text-white/50 font-medium">Dividend</th>
                <th className="text-right px-4 py-3 text-white/50 font-medium">Unrealized</th>
                <th className="text-right px-4 py-3 text-white/50 font-medium">Costs</th>
                <th className="text-right px-4 py-3 text-white/50 font-medium">Deposits</th>
                <th className="px-3 py-3 text-white/50 font-medium w-10"></th>
              </tr>
            </thead>
            <tbody>
              {sortedMonths.map((month, idx) => {
                const m = data[month]
                const isLocked = m.locked
                return (
                  <tr
                    key={month}
                    className={`border-b border-white/5 last:border-0 transition-colors ${
                      isLocked ? "bg-indigo-500/5 border-l-2 border-l-indigo-500/40" : "hover:bg-white/[0.02]"
                    }`}
                  >
                    <td className="px-4 py-3 text-white/80 font-medium whitespace-nowrap">
                      {fmtMonth(month)}
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold tabular-nums ${pnlColor(m.total_pnl)}`}>
                      {fmtSGD(m.total_pnl)}
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums ${pnlColor(m.realized_pnl)}`}>
                      {fmtSGD(m.realized_pnl)}
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums ${pnlColor(m.dividend_pnl)}`}>
                      {fmtSGD(m.dividend_pnl)}
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums ${pnlColor(m.unrealized_pnl)}`}>
                      {fmtSGD(m.unrealized_pnl)}
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums ${pnlColor(m.trading_costs)}`}>
                      {fmtSGD(m.trading_costs)}
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums ${m.deposits > 0 ? "text-sky-400" : "text-gray-500"}`}>
                      {m.deposits !== 0 ? fmtSGD(m.deposits) : "—"}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <button
                        onClick={() => toggleLock(month, isLocked)}
                        disabled={lockingMonth === month}
                        title={isLocked ? "Unlock month" : "Lock month"}
                        className={`p-1.5 rounded-lg transition-colors ${
                          isLocked
                            ? "text-indigo-400 bg-indigo-500/15 hover:bg-indigo-500/25"
                            : "text-white/30 hover:text-white/60 hover:bg-white/5"
                        }`}
                      >
                        {isLocked ? (
                          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                            <path fillRule="evenodd" d="M12 1.5a5.25 5.25 0 00-5.25 5.25v3a3 3 0 00-3 3v6.75a3 3 0 003 3h10.5a3 3 0 003-3v-6.75a3 3 0 00-3-3v-3c0-2.9-2.35-5.25-5.25-5.25zm3.75 8.25v-3a3.75 3.75 0 10-7.5 0v3h7.5z" clipRule="evenodd" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-3.5 h-3.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                          </svg>
                        )}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Upload Modal */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#13131a] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
              <h2 className="text-base font-semibold text-white">Upload Saxo Statement</h2>
              <button
                onClick={() => setUploadModalOpen(false)}
                className="text-white/40 hover:text-white/80 transition-colors"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-white/50">
                Upload the <strong className="text-white/70">Aggregated Amounts</strong> sheet from your Saxo Bank account statement (.xlsx).
              </p>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center gap-3 cursor-pointer transition-colors ${
                  dragActive
                    ? "border-indigo-500 bg-indigo-500/10"
                    : "border-white/10 hover:border-white/20 hover:bg-white/[0.02]"
                }`}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-white/30">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <div className="text-center">
                  <p className="text-sm text-white/60">
                    {dragActive ? "Drop to upload" : "Drop .xlsx here or click to browse"}
                  </p>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f) }}
              />
              {error && (
                <p className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}
              {uploading && (
                <p className="text-sm text-white/50 text-center">Parsing statement…</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
