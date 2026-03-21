import { NextResponse } from 'next/server'

export function middleware(request) {
  const pathname = request.nextUrl.pathname

  // Cron routes: require CRON_SECRET
  if (pathname.startsWith('/api/cron/')) {
    const cronSecret = process.env.CRON_SECRET
    if (cronSecret) {
      const authHeader = request.headers.get('authorization') || ''
      const cronHeader = request.headers.get('x-cron-secret') || request.headers.get('x-cron-key') || ''
      if (authHeader !== `Bearer ${cronSecret}` && authHeader !== cronSecret && cronHeader !== cronSecret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/api/cron/:path*']
}
