import { useState } from "react"
import { Link, NavLink, useNavigate } from "react-router-dom"
import { signOut } from "firebase/auth"
import { auth } from "../firebase"

const NAV_ITEMS = [
  {
    key: "options",
    label: "Options Builder",
    href: "/app/options",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
  },
]

const COMING_SOON = [
  { key: "watchlist", label: "Watchlist" },
  { key: "screener", label: "Screener" },
]

export default function AppShell({ children }) {
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)

  const handleLogout = async () => {
    await signOut(auth)
    navigate("/")
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex">
      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 h-full z-50 flex flex-col border-r border-white/5 bg-[#0a0a0f] transition-all duration-200 ${
          collapsed ? "w-14" : "w-52"
        }`}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-3.5 py-4 border-b border-white/5">
          <Link to="/app" className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-indigo-500 flex items-center justify-center shrink-0">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white">
                <path d="M2.25 2.25a.75.75 0 000 1.5h1.386c.17 0 .318.114.362.278l2.558 9.592a3.752 3.752 0 00-2.806 3.63c0 .414.336.75.75.75h15.75a.75.75 0 000-1.5H5.378A2.25 2.25 0 017.5 15h11.218a.75.75 0 00.674-.421 60.358 60.358 0 002.96-7.228.75.75 0 00-.525-.965A60.864 60.864 0 005.68 4.509l-.232-.867A1.875 1.875 0 003.636 2.25H2.25z" />
              </svg>
            </div>
            {!collapsed && (
              <span className="text-sm font-semibold tracking-tight truncate">Oxas</span>
            )}
          </Link>
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="ml-auto text-gray-600 hover:text-gray-400 transition shrink-0"
            title={collapsed ? "Expand" : "Collapse"}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              {collapsed ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              )}
            </svg>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-0.5 px-2 py-3 flex-1 overflow-y-auto">
          {!collapsed && (
            <p className="text-[10px] font-medium text-gray-700 uppercase tracking-wider px-2 mb-1">Features</p>
          )}
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.key}
              to={item.href}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm transition ${
                  isActive
                    ? "bg-indigo-500/15 text-indigo-300 border border-indigo-500/20"
                    : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.04]"
                } ${collapsed ? "justify-center" : ""}`
              }
              title={collapsed ? item.label : undefined}
            >
              <span className="shrink-0">{item.icon}</span>
              {!collapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          ))}

          {/* Coming soon */}
          {COMING_SOON.map((item) => (
            <div
              key={item.key}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm text-gray-700 cursor-default ${
                collapsed ? "justify-center" : ""
              }`}
              title={collapsed ? `${item.label} (coming soon)` : undefined}
            >
              <span className="shrink-0">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-4 h-4">
                  <circle cx="12" cy="12" r="9" />
                  <path strokeLinecap="round" d="M12 8v4l2 2" />
                </svg>
              </span>
              {!collapsed && (
                <span className="truncate flex items-center gap-1.5">
                  {item.label}
                  <span className="text-[9px] bg-white/5 border border-white/8 rounded px-1 py-0.5 text-gray-700">soon</span>
                </span>
              )}
            </div>
          ))}
        </nav>

        {/* User / logout */}
        <div className="border-t border-white/5 px-2 py-3 flex flex-col gap-1">
          {!collapsed && auth.currentUser?.email && (
            <p className="text-xs text-gray-700 truncate px-2.5 pb-1">{auth.currentUser.email}</p>
          )}
          <button
            onClick={handleLogout}
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm text-gray-600 hover:text-gray-300 hover:bg-white/[0.04] transition ${
              collapsed ? "justify-center" : ""
            }`}
            title={collapsed ? "Log out" : undefined}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-4 h-4 shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
            </svg>
            {!collapsed && <span>Log out</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className={`flex-1 transition-all duration-200 ${collapsed ? "ml-14" : "ml-52"}`}>
        {children}
      </div>
    </div>
  )
}
