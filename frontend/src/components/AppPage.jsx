import { useState } from "react"
import { signOut } from "firebase/auth"
import { useNavigate, Link } from "react-router-dom"
import { auth } from "../firebase"
import LegForm from "./LegForm"
import LegList from "./LegList"
import ResultsTable from "./ResultsTable"
import ViewInput from "./ViewInput"
import StrategyProposal from "./StrategyProposal"

export default function AppPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState("ai") // "ai" | "manual"

  // AI flow
  const [aiIdentifying, setAiIdentifying] = useState(false)
  const [aiProposal, setAiProposal] = useState(null)

  // Manual flow
  const [legs, setLegs] = useState([])
  const [sameExpiry, setSameExpiry] = useState(false)

  // Shared
  const [sortBy, setSortBy] = useState("ask")
  const [results, setResults] = useState(null)
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
      setResults(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setAiIdentifying(false)
    }
  }

  const handleConfirmProposal = async () => {
    if (!aiProposal) return
    const searchLegs = aiProposal.legs.map((leg) => ({
      ticker: aiProposal.ticker,
      option_type: leg.option_type,
      side: leg.side,
      expiry_from: leg.expiry_from,
      expiry_to: leg.expiry_to,
      strike_min: leg.strike_hint != null ? Math.round(leg.strike_hint * 0.90) : null,
      strike_max: leg.strike_hint != null ? Math.round(leg.strike_hint * 1.10) : null,
    }))
    await runSearch(searchLegs, aiProposal.same_expiry)
  }

  const handleManualSearch = async () => {
    await runSearch(legs, sameExpiry)
  }

  const runSearch = async (searchLegs, useSameExpiry) => {
    setError("")
    setSearching(true)
    setResults(null)
    try {
      const token = await getToken()
      const res = await fetch("/api/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ legs: searchLegs, sort_by: sortBy, same_expiry: useSameExpiry }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `Server error ${res.status}`)
      setResults(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setSearching(false)
    }
  }

  const handleEditManually = () => {
    setMode("manual")
    setResults(null)
    setError("")
  }

  const handleLogout = async () => {
    await signOut(auth)
    navigate("/")
  }

  const switchMode = (newMode) => {
    setMode(newMode)
    setResults(null)
    setError("")
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-4 border-b border-white/5 bg-[#0a0a0f]/80 backdrop-blur-md">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-500 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white">
              <path d="M2.25 2.25a.75.75 0 000 1.5h1.386c.17 0 .318.114.362.278l2.558 9.592a3.752 3.752 0 00-2.806 3.63c0 .414.336.75.75.75h15.75a.75.75 0 000-1.5H5.378A2.25 2.25 0 017.5 15h11.218a.75.75 0 00.674-.421 60.358 60.358 0 002.96-7.228.75.75 0 00-.525-.965A60.864 60.864 0 005.68 4.509l-.232-.867A1.875 1.875 0 003.636 2.25H2.25z" />
            </svg>
          </div>
          <span className="text-base font-semibold tracking-tight">Oxas</span>
        </Link>
        <div className="flex items-center gap-4">
          {auth.currentUser && (
            <span className="text-sm text-gray-600 hidden sm:block">{auth.currentUser.email}</span>
          )}
          <button
            onClick={handleLogout}
            className="text-sm text-gray-500 hover:text-white border border-white/10 hover:border-white/20 px-3 py-1.5 rounded-lg transition"
          >
            Log out
          </button>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 pt-28 pb-16 flex flex-col gap-5">
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
                onReset={() => { setAiProposal(null); setResults(null); setError("") }}
                loading={searching}
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
              onSortByChange={(v) => { setSortBy(v); setResults(null) }}
              sameExpiry={sameExpiry}
              onSameExpiryChange={(v) => { setSameExpiry(v); setResults(null) }}
              onSearch={handleManualSearch}
              loading={searching}
            />
          </>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm px-4 py-3 rounded-xl">
            {error}
          </div>
        )}

        {results && <ResultsTable results={results} sortBy={sortBy} />}
      </main>
    </div>
  )
}
