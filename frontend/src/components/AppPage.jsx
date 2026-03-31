import { useState } from "react"
import { signOut } from "firebase/auth"
import { useNavigate, Link } from "react-router-dom"
import { auth } from "../firebase"
import LegForm from "./LegForm"
import LegList from "./LegList"
import ResultsTable from "./ResultsTable"

export default function AppPage() {
  const navigate = useNavigate()
  const [legs, setLegs] = useState([])
  const [sortBy, setSortBy] = useState("ask")
  const [sameExpiry, setSameExpiry] = useState(false)
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const addLeg = (leg) => setLegs((prev) => [...prev, leg])
  const removeLeg = (i) => setLegs((prev) => prev.filter((_, idx) => idx !== i))

  const handleSearch = async () => {
    setError("")
    setLoading(true)
    try {
      let token = null
      if (auth.currentUser) {
        token = await auth.currentUser.getIdToken()
      }

      const res = await fetch("/api/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ legs, sort_by: sortBy, same_expiry: sameExpiry }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || `Server error ${res.status}`)
      }

      setResults(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    await signOut(auth)
    navigate("/")
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
        <div className="mb-2">
          <h1 className="text-2xl font-bold text-white">Strategy Builder</h1>
          <p className="text-sm text-gray-500 mt-1">
            Add legs, set your sort metric, and surface the cheapest matching contracts from live Yahoo Finance data.
          </p>
        </div>

        <LegForm onAdd={addLeg} />

        <LegList
          legs={legs}
          onRemove={removeLeg}
          sortBy={sortBy}
          onSortByChange={(v) => { setSortBy(v); setResults(null) }}
          sameExpiry={sameExpiry}
          onSameExpiryChange={(v) => { setSameExpiry(v); setResults(null) }}
          onSearch={handleSearch}
          loading={loading}
        />

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
