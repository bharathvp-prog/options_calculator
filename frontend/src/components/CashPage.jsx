import { useState, useEffect, useRef } from "react"
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

function fmt(n) {
  return Number(n).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

// Returns the cash balance effective on a given ISO date string
export function getCashForDate(cashHistory, dateStr) {
  if (!cashHistory || cashHistory.length === 0) return 0
  let val = 0
  for (const entry of cashHistory) {
    if (entry.date <= dateStr) val = entry.amount
    else break
  }
  return val
}

function EditModal({ cashHistory, onSave, onClose }) {
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(todayIso())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const amountRef = useRef(null)

  // Pre-fill with the balance that was in effect on the selected date
  useEffect(() => {
    const existing = cashHistory.find(e => e.date === date)
    if (existing) {
      setAmount(String(existing.amount))
    } else {
      const effective = getCashForDate(cashHistory, date)
      setAmount(effective > 0 ? String(effective) : "")
    }
  }, [date])

  useEffect(() => { amountRef.current?.focus(); amountRef.current?.select() }, [])

  const handleSave = async () => {
    const num = parseFloat(amount)
    if (isNaN(num) || num < 0) {
      setError("Please enter a valid amount (0 or above).")
      return
    }
    setSaving(true)
    setError("")
    try {
      const data = await apiFetch("/api/portfolio/cash", {
        method: "PATCH",
        body: JSON.stringify({ amount: num, date }),
      })
      onSave(data.cash_history)
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSave()
    if (e.key === "Escape") onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#111118] border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <h2 className="text-base font-semibold text-white mb-1">Record Cash Balance</h2>
        <p className="text-xs text-gray-500 mb-5">Set the effective date — historical chart will use this value from that date onwards until the next recorded change.</p>

        <div className="flex flex-col gap-3 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1.5">Effective Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              max={todayIso()}
              className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1.5">Amount (SGD)</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm select-none">SGD</span>
              <input
                ref={amountRef}
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setError("") }}
                onKeyDown={handleKeyDown}
                placeholder="0.00"
                className="w-full pl-12 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50"
              />
            </div>
          </div>
        </div>

        {error && <p className="text-xs text-rose-400 mb-3">{error}</p>}

        <div className="flex gap-2.5">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm text-gray-400 hover:text-gray-200 border border-white/10 hover:bg-white/5 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-sm font-medium text-white shadow-lg shadow-indigo-500/20 transition"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function CashPage() {
  const [cashHistory, setCashHistory] = useState(null) // null = loading
  const [modalOpen, setModalOpen] = useState(false)

  useEffect(() => {
    apiFetch("/api/portfolio/cash")
      .then((data) => setCashHistory(data.cash_history ?? []))
      .catch(() => setCashHistory([]))
  }, [])

  const loading = cashHistory === null
  const currentCash = cashHistory ? getCashForDate(cashHistory, todayIso()) : 0
  const hasHistory = cashHistory && cashHistory.length > 0

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-md">
        <h1 className="text-xl font-semibold text-white mb-1">Cash Balance</h1>
        <p className="text-sm text-gray-500 mb-8">
          Track your SGD cash over time. Each entry records the balance from an effective date — the chart uses the correct value for each historical day.
        </p>

        <div className="bg-white/[0.02] border border-white/8 rounded-2xl p-6 mb-4">
          {loading ? (
            <div className="h-16 bg-white/5 rounded-xl animate-pulse" />
          ) : hasHistory ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Current Balance (SGD)</p>
                <p className="text-3xl font-bold text-white">{fmt(currentCash)}</p>
              </div>
              <button
                onClick={() => setModalOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm text-gray-400 hover:text-gray-200 border border-white/10 hover:bg-white/5 transition"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-3.5 h-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add entry
              </button>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-gray-500 mb-4">No cash balance recorded yet.</p>
              <button
                onClick={() => setModalOpen(true)}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-sm font-medium text-white shadow-lg shadow-indigo-500/20 transition"
              >
                Add Cash Balance
              </button>
            </div>
          )}
        </div>

        {/* History list */}
        {hasHistory && (
          <div className="bg-white/[0.02] border border-white/8 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-white/5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">History</p>
            </div>
            <div className="divide-y divide-white/5">
              {[...cashHistory].reverse().map((entry, i) => (
                <div key={entry.date} className="flex items-center justify-between px-5 py-3">
                  <span className="text-sm text-gray-400">{entry.date}</span>
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-medium ${i === 0 ? "text-white" : "text-gray-400"}`}>
                      SGD {fmt(entry.amount)}
                    </span>
                    {i === 0 && (
                      <span className="text-[10px] bg-indigo-500/15 text-indigo-400 border border-indigo-500/20 rounded px-1.5 py-0.5">current</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {modalOpen && (
        <EditModal
          cashHistory={cashHistory ?? []}
          onSave={(history) => { setCashHistory(history); setModalOpen(false) }}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  )
}
