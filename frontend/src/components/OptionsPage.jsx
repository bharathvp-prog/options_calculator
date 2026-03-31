import { useState } from "react"
import { auth } from "../firebase"
import LegForm from "./LegForm"
import LegList from "./LegList"
import ResultsTable from "./ResultsTable"
import ViewInput from "./ViewInput"
import StrategyProposal from "./StrategyProposal"
import ComparisonView from "./ComparisonView"
import PayoffCalculator from "./PayoffCalculator"

export default function OptionsPage() {
  const [mode, setMode] = useState("ai") // "ai" | "manual"

  // AI flow
  const [aiIdentifying, setAiIdentifying] = useState(false)
  const [aiProposal, setAiProposal] = useState(null)
  const [comparisonResults, setComparisonResults] = useState(null)
  const [selectedHorizon, setSelectedHorizon] = useState(null)
  const [payoffHorizon, setPayoffHorizon] = useState(null) // modal state

  // Manual flow
  const [legs, setLegs] = useState([])
  const [sameExpiry, setSameExpiry] = useState(false)
  const [manualResults, setManualResults] = useState(null)

  // Shared
  const [sortBy, setSortBy] = useState("ask")
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState("")

  const addLeg = (leg) => setLegs((prev) => [...prev, leg])
  const removeLeg = (i) => setLegs((prev) => prev.filter((_, idx) => idx !== i))

  const getToken = async () => {
    if (!auth.currentUser) return null
    return await auth.currentUser.getIdToken()
  }

  const handleIdentifyStrategy = async (view) => {
    setError("")
    setAiIdentifying(true)
    try {
      const res = await fetch("/api/strategy/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ view }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || "Failed to identify strategy")
      setAiProposal(data)
      setComparisonResults(null)
      setSelectedHorizon(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setAiIdentifying(false)
    }
  }

  const handleConfirmProposal = async (legsWithQty) => {
    setError("")
    setSearching(true)
    setComparisonResults(null)
    setSelectedHorizon(null)
    try {
      const token = await getToken()
      const res = await fetch("/api/strategy/compare", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          ticker: aiProposal.ticker,
          legs: legsWithQty.map((l) => ({
            option_type: l.option_type,
            side: l.side,
            strike_hint: l.strike_hint,
            qty: l.qty,
          })),
          sort_by: sortBy,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `Server error ${res.status}`)
      setComparisonResults(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setSearching(false)
    }
  }

  const handleManualSearch = async () => {
    setError("")
    setSearching(true)
    setManualResults(null)
    try {
      const token = await getToken()
      const res = await fetch("/api/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ legs, sort_by: sortBy, same_expiry: sameExpiry }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `Server error ${res.status}`)
      setManualResults(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setSearching(false)
    }
  }

  const handleEditManually = () => {
    setMode("manual")
    setComparisonResults(null)
    setSelectedHorizon(null)
    setError("")
  }

  const switchMode = (newMode) => {
    setMode(newMode)
    setComparisonResults(null)
    setManualResults(null)
    setSelectedHorizon(null)
    setError("")
  }

  return (
    <main className="max-w-5xl mx-auto px-6 pt-10 pb-16 flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <h1 className="text-2xl font-bold text-white">Strategy Builder</h1>
          <p className="text-sm text-gray-500 mt-1">
            Describe your market view or build legs manually to find the cheapest matching contracts.
          </p>
        </div>
        <div className="flex items-center bg-white/[0.03] border border-white/10 rounded-xl p-1 shrink-0">
          {[
            { key: "ai", label: "Smart" },
            { key: "manual", label: "Manual" },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => switchMode(key)}
              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition ${
                mode === key
                  ? "bg-indigo-600 text-white shadow"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === "ai" ? (
        <>
          {!aiProposal ? (
            <ViewInput onSubmit={handleIdentifyStrategy} loading={aiIdentifying} />
          ) : (
            <StrategyProposal
              proposal={aiProposal}
              onConfirm={handleConfirmProposal}
              onEditManually={handleEditManually}
              onReset={() => {
                setAiProposal(null)
                setComparisonResults(null)
                setSelectedHorizon(null)
                setError("")
              }}
              loading={searching}
            />
          )}

          {comparisonResults && (
            <ComparisonView
              data={comparisonResults}
              selectedExpiry={selectedHorizon?.expiry}
              onSelectHorizon={setSelectedHorizon}
              onViewPayoff={setPayoffHorizon}
            />
          )}
        </>
      ) : (
        <>
          <LegForm onAdd={addLeg} />
          <LegList
            legs={legs}
            onRemove={removeLeg}
            sortBy={sortBy}
            onSortByChange={(v) => { setSortBy(v); setManualResults(null) }}
            sameExpiry={sameExpiry}
            onSameExpiryChange={(v) => { setSameExpiry(v); setManualResults(null) }}
            onSearch={handleManualSearch}
            loading={searching}
          />
          {manualResults && <ResultsTable results={manualResults} sortBy={sortBy} />}
        </>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm px-4 py-3 rounded-xl">
          {error}
        </div>
      )}

      {/* Payoff Modal Overlay */}
      {payoffHorizon && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setPayoffHorizon(null)}
        >
          <div
            className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto m-4 rounded-2xl shadow-2xl shadow-black/50 border border-white/10 bg-[#0e0e12]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setPayoffHorizon(null)}
              className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition border border-white/10"
            >
              ✕
            </button>
            <PayoffCalculator
              horizon={payoffHorizon}
              strategyName={aiProposal?.strategy_name}
              ticker={aiProposal?.ticker}
            />
          </div>
        </div>
      )}
    </main>
  )
}

