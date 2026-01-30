export const dynamic = 'force-dynamic'

export async function GET(request) {
  return Response.json({
    message: 'Use Vercel Dashboard to view logs',
    url: 'https://vercel.com/dashboard'
  })
}

