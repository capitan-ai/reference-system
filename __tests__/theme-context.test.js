/**
 * @jest-environment jsdom
 */

const React = require('react')
const { render, screen, fireEvent } = require('@testing-library/react')
const {
  ThemeProvider,
  useTheme,
  resolveInitialTheme,
} = require('../lib/theme-context')

describe('theme context helpers', () => {
  beforeEach(() => {
    window.localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  test('resolveInitialTheme prioritizes stored value', () => {
    expect(resolveInitialTheme({ storedValue: 'dark', prefersDark: false })).toBe('dark')
    expect(resolveInitialTheme({ storedValue: 'light', prefersDark: true })).toBe('light')
  })

  test('resolveInitialTheme falls back to prefers-color-scheme', () => {
    expect(resolveInitialTheme({ storedValue: 'unknown', prefersDark: true })).toBe('dark')
    expect(resolveInitialTheme({ storedValue: undefined, prefersDark: false })).toBe('light')
  })

  test('ThemeProvider toggles theme and updates DOM/localStorage', () => {
    function TestComponent() {
      const { theme, toggleTheme } = useTheme()
      return React.createElement(
        React.Fragment,
        null,
        React.createElement('span', { 'data-testid': 'theme-value' }, theme),
        React.createElement('button', { onClick: toggleTheme }, 'toggle'),
      )
    }

    render(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(TestComponent, null),
      ),
    )

    const themeValue = screen.getByTestId('theme-value')
    expect(themeValue.textContent).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')

    fireEvent.click(screen.getByText('toggle'))

    expect(themeValue.textContent).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem('zorina-theme')).toBe('dark')
  })
})

