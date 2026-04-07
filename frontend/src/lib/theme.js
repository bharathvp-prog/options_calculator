const STORAGE_KEY = "oxas-theme"

export function getStoredTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) || "dark"
  } catch {
    return "dark"
  }
}

export function applyTheme(theme) {
  if (theme === "light") {
    document.documentElement.classList.add("light")
  } else {
    document.documentElement.classList.remove("light")
  }
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {}
}

export function toggleTheme() {
  const current = document.documentElement.classList.contains("light") ? "light" : "dark"
  const next = current === "light" ? "dark" : "light"
  applyTheme(next)
  return next
}
