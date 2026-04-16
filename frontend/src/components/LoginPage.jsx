import { useState, useEffect } from "react"
import { useNavigate, Link } from "react-router-dom"
import {
  signInWithPopup,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "firebase/auth"
import { auth } from "../firebase"

export default function LoginPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState("signin")

  useEffect(() => {
    const html = document.documentElement
    const hadLight = html.classList.contains("light")
    html.classList.remove("light")
    return () => { if (hadLight) html.classList.add("light") }
  }, [])
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const handleGoogle = async () => {
    setError("")
    setLoading(true)
    try {
      await signInWithPopup(auth, new GoogleAuthProvider())
      navigate("/app/portfolio")
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEmail = async (e) => {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      if (mode === "signin") {
        await signInWithEmailAndPassword(auth, email, password)
      } else {
        await createUserWithEmailAndPassword(auth, email, password)
      }
      navigate("/app/portfolio")
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-center px-4 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-indigo-600/15 rounded-full blur-[100px] pointer-events-none" />

      <Link to="/" className="relative z-10 flex items-center gap-2 mb-8">
        <div className="w-7 h-7 rounded-lg bg-indigo-500 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none">
            <rect x="3" y="8" width="3" height="8" rx="0.5" fill="white" />
            <line x1="4.5" y1="5" x2="4.5" y2="8" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="4.5" y1="16" x2="4.5" y2="19" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            <rect x="10.5" y="5" width="3" height="10" rx="0.5" fill="white" />
            <line x1="12" y1="3" x2="12" y2="5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="12" y1="15" x2="12" y2="19" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            <rect x="18" y="7" width="3" height="7" rx="0.5" fill="white" />
            <line x1="19.5" y1="4" x2="19.5" y2="7" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="19.5" y1="14" x2="19.5" y2="18" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <span className="text-base font-semibold tracking-tight text-white">ArkenVault</span>
      </Link>

      <div className="relative z-10 w-full max-w-md bg-white/[0.03] border border-white/10 rounded-2xl p-8 shadow-2xl shadow-black/50">
        <h1 className="text-2xl font-bold text-white mb-1">
          {mode === "signin" ? "Welcome back" : "Create your account"}
        </h1>
        <p className="text-sm text-gray-500 mb-7">
          {mode === "signin" ? "Sign in to access ArkenVault" : "Get started for free — no credit card needed"}
        </p>

        {/* Google */}
        <button
          onClick={handleGoogle}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm font-medium text-gray-300 hover:bg-white/10 hover:border-white/20 transition mb-6 disabled:opacity-50"
        >
          <svg className="w-5 h-5" viewBox="0 0 48 48">
            <path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.7 33.9 29.8 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 5.1 29.6 3 24 3 12.9 3 4 11.9 4 23s8.9 20 20 20c11 0 19.7-8 19.7-20 0-1.3-.1-2.7-.2-3z"/>
            <path fill="#34A853" d="M6.3 14.7l7 5.1C15.1 16.3 19.2 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 5.1 29.6 3 24 3 16.3 3 9.7 7.8 6.3 14.7z"/>
            <path fill="#FBBC05" d="M24 43c5.5 0 10.5-1.9 14.3-5.1l-6.6-5.4C29.6 34.3 27 35 24 35c-5.7 0-10.6-3.1-11.7-7.4l-7 5.4C8 39.3 15.4 43 24 43z"/>
            <path fill="#EA4335" d="M44.5 20H24v8.5h11.8c-.9 3-3.3 5.5-6.3 7l6.6 5.4C40.4 37 44 31 44 24c0-1.3-.1-2.7-.5-4z"/>
          </svg>
          Continue with Google
        </button>

        <div className="flex items-center gap-3 mb-6">
          <hr className="flex-1 border-white/8" />
          <span className="text-xs text-gray-600">or</span>
          <hr className="flex-1 border-white/8" />
        </div>

        <form onSubmit={handleEmail} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition text-sm disabled:opacity-50 shadow-lg shadow-indigo-500/20 mt-1"
          >
            {loading ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-600">
          {mode === "signin" ? (
            <>
              Don&apos;t have an account?{" "}
              <button
                onClick={() => { setMode("signup"); setError("") }}
                className="text-indigo-400 font-medium hover:text-indigo-300 transition"
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                onClick={() => { setMode("signin"); setError("") }}
                className="text-indigo-400 font-medium hover:text-indigo-300 transition"
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
