import { useState } from "react"
import { Link, NavLink, useNavigate } from "react-router-dom"
import { signOut } from "firebase/auth"
import { auth } from "../firebase"
import { toggleTheme, getStoredTheme } from "../lib/theme.js"

const NAV_ITEMS = [
  {
    key: "portfolio",
    label: "Portfolio",
    href: "/app/portfolio",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
      </svg>
    ),
  },
  {
    key: "wheeling",
    label: "Options Wheeling",
    href: "/app/wheeling",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
      </svg>
    ),
  },
  {
    key: "stock",
    label: "Stock Lookup",
    href: "/app/stock",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
      </svg>
    ),
  },
  {
    key: "screener",
    label: "Screener",
    href: "/app/screener",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
      </svg>
    ),
  },
  {
    key: "plans",
    label: "Plans",
    href: "/app/plans",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
  },
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
  {
    key: "performance",
    label: "Performance",
    href: "/app/performance",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
      </svg>
    ),
  },
  {
    key: "cash",
    label: "Cash",
    href: "/app/cash",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75" />
      </svg>
    ),
  },
]

const COMING_SOON = []

export default function AppShell({ children }) {
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const [theme, setTheme] = useState(getStoredTheme)

  const handleLogout = async () => {
    await signOut(auth)
    navigate("/")
  }

  const handleToggleTheme = () => {
    const next = toggleTheme()
    setTheme(next)
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
            {!collapsed && (
              <span className="text-sm font-semibold tracking-tight truncate">ArkenVault</span>
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
          {/* Theme toggle */}
          <button
            onClick={handleToggleTheme}
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm text-gray-600 hover:text-gray-300 hover:bg-white/[0.04] transition ${
              collapsed ? "justify-center" : ""
            }`}
            title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
          >
            {theme === "light" ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-4 h-4 shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75 9.75 9.75 0 018.25 6 9.718 9.718 0 019 2.248a9.75 9.75 0 0012.752 12.754z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-4 h-4 shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
              </svg>
            )}
            {!collapsed && <span>{theme === "light" ? "Dark mode" : "Light mode"}</span>}
          </button>
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
