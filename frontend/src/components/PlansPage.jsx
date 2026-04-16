import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { auth } from "../firebase"

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

function pctColor(v) {
  if (v == null) return "text-gray-500"
  return v >= 0 ? "text-emerald-400" : "text-rose-400"
}

function formatPct(v) {
  if (v == null) return "—"
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`
}

function formatPrice(v) {
  if (v == null) return "—"
  return `$${v.toFixed(2)}`
}

function ScenarioCell({ implied, upside }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sm font-semibold text-white">{formatPrice(implied)}</span>
      <span className={`text-xs font-medium ${pctColor(upside)}`}>{formatPct(upside)}</span>
    </div>
  )
}

export default function PlansPage() {
  const navigate = useNavigate()
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState(null)
  const [error, setError] = useState("")

  useEffect(() => {
    apiFetch("/api/plans")
      .then(d => setPlans(d.plans || []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  async function handleDelete(e, id) {
    e.stopPropagation()
    if (!window.confirm("Delete this plan?")) return
    setDeletingId(id)
    try {
      await apiFetch(`/api/plans/${id}`, { method: "DELETE" })
      setPlans(prev => prev.filter(p => p.id !== id))
    } catch (err) {
      alert("Failed to delete plan: " + err.message)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Stock Plans</h1>
          <p className="text-sm text-gray-400 mt-1">Build and track your 5-year financial forecasts</p>
        </div>
        <button
          onClick={() => navigate("/app/plans/new")}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-xl shadow-lg shadow-indigo-500/20 transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Plan
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20 text-gray-500 text-sm">
          Loading plans…
        </div>
      )}

      {error && !loading && (
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 text-rose-400 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && plans.length === 0 && (
        <div className="bg-white/[0.02] border border-white/8 rounded-2xl p-16 flex flex-col items-center gap-4">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-12 h-12 text-gray-600">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <div className="text-center">
            <p className="text-gray-300 font-medium">No plans yet</p>
            <p className="text-gray-500 text-sm mt-1">Create your first stock forecast to get started</p>
          </div>
          <button
            onClick={() => navigate("/app/plans/new")}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors mt-2"
          >
            Create a Plan
          </button>
        </div>
      )}

      {!loading && plans.length > 0 && (
        <div className="bg-white/[0.02] border border-white/8 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8 text-[11px] text-gray-500 uppercase tracking-wider">
                <th className="px-5 py-3 text-left font-medium">Ticker</th>
                <th className="px-5 py-3 text-left font-medium">Name</th>
                <th className="px-5 py-3 text-left font-medium">Current</th>
                <th className="px-5 py-3 text-left font-medium">Bear</th>
                <th className="px-5 py-3 text-left font-medium">Base</th>
                <th className="px-5 py-3 text-left font-medium">Bull</th>
                <th className="px-5 py-3 text-left font-medium">Updated</th>
                <th className="px-5 py-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan, i) => (
                <tr
                  key={plan.id}
                  onClick={() => navigate(`/app/plans/${plan.ticker}?planId=${plan.id}`)}
                  className={`cursor-pointer hover:bg-white/[0.03] transition-colors ${i < plans.length - 1 ? "border-b border-white/5" : ""}`}
                >
                  <td className="px-5 py-4">
                    <span className="font-bold text-white">{plan.ticker}</span>
                  </td>
                  <td className="px-5 py-4 text-gray-300 max-w-[180px] truncate">{plan.name}</td>
                  <td className="px-5 py-4 text-gray-400">
                    {plan.current_price != null ? `$${plan.current_price.toFixed(2)}` : "—"}
                  </td>
                  <td className="px-5 py-4">
                    <ScenarioCell implied={plan.implied?.bear} upside={plan.upside?.bear} />
                  </td>
                  <td className="px-5 py-4">
                    <ScenarioCell implied={plan.implied?.base} upside={plan.upside?.base} />
                  </td>
                  <td className="px-5 py-4">
                    <ScenarioCell implied={plan.implied?.bull} upside={plan.upside?.bull} />
                  </td>
                  <td className="px-5 py-4 text-gray-500 text-xs">
                    {plan.updated_at ? new Date(plan.updated_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <button
                      onClick={e => handleDelete(e, plan.id)}
                      disabled={deletingId === plan.id}
                      className="text-gray-600 hover:text-rose-400 transition-colors p-1 rounded"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
