import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import LandingPage from "./components/LandingPage"
import LoginPage from "./components/LoginPage"
import ProtectedRoute from "./components/ProtectedRoute"
import AppShell from "./components/AppShell"
import DashboardPage from "./components/DashboardPage"
import OptionsPage from "./components/OptionsPage"

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
        <Route path="/app" element={<ProtectedShell><DashboardPage /></ProtectedShell>} />
        <Route path="/app/options" element={<ProtectedShell><OptionsPage /></ProtectedShell>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
