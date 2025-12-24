import './globals.css'
import { Inter, Playfair_Display } from 'next/font/google'
import { ThemeProvider } from '../lib/theme-context'

const inter = Inter({ subsets: ['latin'], variable: '--font-body' })
const playfair = Playfair_Display({ subsets: ['latin'], variable: '--font-display' })

export const metadata = {
  title: 'Реферальная система салона',
  description: 'Система реферальных программ с автоматическими бонусами и уведомлениями',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${playfair.variable}`}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}