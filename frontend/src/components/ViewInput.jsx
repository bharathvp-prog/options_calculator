import { useState } from "react"
import useSpeechRecognition from "../hooks/useSpeechRecognition"

const EXAMPLES = [
  "I'm confident AMD will grow to 250 but no more than 300 by June 2028",
  "NVDA will crash below 80 by end of 2025",
  "TSLA will make a big move after earnings in January 2026",
  "AAPL will stay flat around 220 through March 2026",
]

export default function ViewInput({ onSubmit, loading }) {
  const [view, setView] = useState("")
  const { supported, listening, start, stop, isProcessingAI, aiLoadingMessage } = useSpeechRecognition()

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!view.trim()) return
    onSubmit(view)
  }

  const handleMic = () => {
    if (listening) {
      stop()
    } else {
      start((text) => setView(text))
    }
  }

  return (
    <div className="bg-white/[0.02] border border-white/8 rounded-2xl p-6">
      <h2 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
        <span className="w-5 h-5 rounded-md bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 text-indigo-400">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
          </svg>
        </span>
        Describe your market view
      </h2>
      <p className="text-xs text-gray-600 mb-4 ml-7">
        Tell us what you think will happen — we'll identify the right strategy and find the cheapest contracts.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="relative">
          <textarea
            value={view}
            onChange={(e) => setView(e.target.value)}
            placeholder="e.g. I'm confident AMD will grow to 250 but no more than 300 by June 2028"
            rows={3}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition resize-none pr-12"
          />
          <button
            type="button"
            onClick={supported && !isProcessingAI ? handleMic : undefined}
            title={
              !supported
                ? "Voice input requires Chrome or Edge"
                : isProcessingAI
                ? "Processing your voice..."
                : listening
                ? "Stop recording"
                : "Speak your view"
            }
            className={`absolute bottom-3 right-3 w-7 h-7 rounded-lg flex items-center justify-center transition ${
              !supported
                ? "bg-white/5 border border-white/10 text-gray-700 cursor-not-allowed"
                : isProcessingAI
                ? "bg-indigo-500/20 border border-indigo-500/40 text-indigo-400 cursor-wait"
                : listening
                ? "bg-rose-500/20 border border-rose-500/40 text-rose-400"
                : "bg-white/5 border border-white/10 text-gray-500 hover:text-gray-300 hover:bg-white/10"
            }`}
          >
            {isProcessingAI ? (
              <span className="w-3 h-3 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
            ) : listening ? (
              <span className="w-2.5 h-2.5 rounded-sm bg-rose-400 animate-pulse" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
              </svg>
            )}
          </button>
        </div>

        {aiLoadingMessage && (
          <p className="text-xs text-indigo-400 flex items-center gap-1.5 -mt-2">
            <span className="w-3 h-3 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
            {aiLoadingMessage}
          </p>
        )}

        {listening && !aiLoadingMessage && (
          <p className="text-xs text-rose-400 flex items-center gap-1.5 -mt-2">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
            Listening…
          </p>
        )}

        {isProcessingAI && !listening && (
          <p className="text-xs text-indigo-400 flex items-center gap-1.5 -mt-2">
            <span className="w-3 h-3 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
            Decoding audio…
          </p>
        )}

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-gray-700">Try an example:</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((ex, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setView(ex)}
                  className="text-xs text-gray-600 hover:text-gray-300 bg-white/[0.03] hover:bg-white/[0.06] border border-white/8 hover:border-white/15 rounded-lg px-2.5 py-1 transition"
                >
                  {ex.slice(0, 42)}…
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={!view.trim() || loading}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg shadow-indigo-500/20 shrink-0"
          >
            {loading && (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            )}
            {loading ? "Identifying…" : "Identify Strategy →"}
          </button>
        </div>
      </form>
    </div>
  )
}
