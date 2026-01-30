'use client'

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'zorina-theme'
const ThemeContext = createContext({
  theme: 'light',
  toggleTheme: () => {},
})

export function resolveInitialTheme({ storedValue, prefersDark } = {}) {
  if (storedValue === 'light' || storedValue === 'dark') {
    return storedValue
  }
  return prefersDark ? 'dark' : 'light'
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState('light')

  // Determine initial theme (localStorage -> prefers-color-scheme -> light)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = window.localStorage?.getItem(STORAGE_KEY)
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
    setTheme(resolveInitialTheme({ storedValue: stored, prefersDark }))
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.dataset.theme = theme
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, theme)
    }
  }, [theme])

  const value = useMemo(
    () => ({
      theme,
      toggleTheme: () => setTheme((prev) => (prev === 'light' ? 'dark' : 'light')),
    }),
    [theme],
  )

  return React.createElement(ThemeContext.Provider, { value }, children)
}

export function useTheme() {
  return useContext(ThemeContext)
}

