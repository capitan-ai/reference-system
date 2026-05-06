export const dynamic = 'force-dynamic'

export async function GET(request) {
  return Response.json({
    test: 'working',
    timestamp: new Date().toISOString(),
    status: 'ok'
  })
}
