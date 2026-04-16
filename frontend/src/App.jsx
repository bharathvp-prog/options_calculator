import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import LandingPage from "./components/LandingPage"
import LoginPage from "./components/LoginPage"
import ProtectedRoute from "./components/ProtectedRoute"
import AppShell from "./components/AppShell"
import DashboardPage from "./components/DashboardPage"
import OptionsPage from "./components/OptionsPage"
import PortfolioPage from "./components/PortfolioPage"
import OptionsCyclingPage from "./components/OptionsCyclingPage"
import CashPage from "./components/CashPage"
import HistoricalPerformancePage from "./components/HistoricalPerformancePage"
import StockPage from "./components/StockPage"
import ScreenerPage from "./components/ScreenerPage"
import PlansPage from "./components/PlansPage"
import PlanningPage from "./components/PlanningPage"

function ProtectedShell({ children }) {
  return (
    <ProtectedRoute>
      <AppShell>{children}</AppShell>
    </ProtectedRoute>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/app" element={<ProtectedShell><Navigate to="/app/portfolio" replace /></ProtectedShell>} />
        <Route path="/app/options" element={<ProtectedShell><OptionsPage /></ProtectedShell>} />
        <Route path="/app/portfolio" element={<ProtectedShell><PortfolioPage /></ProtectedShell>} />
        <Route path="/app/wheeling" element={<ProtectedShell><OptionsCyclingPage /></ProtectedShell>} />
        <Route path="/app/cycling" element={<Navigate to="/app/wheeling" replace />} />
        <Route path="/app/cash" element={<ProtectedShell><CashPage /></ProtectedShell>} />
        <Route path="/app/performance" element={<ProtectedShell><HistoricalPerformancePage /></ProtectedShell>} />
        <Route path="/app/stock" element={<ProtectedShell><StockPage /></ProtectedShell>} />
        <Route path="/app/stock/:ticker" element={<ProtectedShell><StockPage /></ProtectedShell>} />
        <Route path="/app/screener" element={<ProtectedShell><ScreenerPage /></ProtectedShell>} />
        <Route path="/app/plans" element={<ProtectedShell><PlansPage /></ProtectedShell>} />
        <Route path="/app/plans/:ticker" element={<ProtectedShell><PlanningPage /></ProtectedShell>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
