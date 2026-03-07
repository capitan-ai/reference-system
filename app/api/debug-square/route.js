const { Client, Environment } = require('square')

export async function GET() {
  const accessToken = process.env.SQUARE_ACCESS_TOKEN?.trim()

  if (!accessToken) {
    return Response.json(
      { ok: false, error: 'SQUARE_ACCESS_TOKEN missing in environment' },
      { status: 500 }
    )
  }

  try {
    const client = new Client({
      accessToken,
      environment: Environment.Production
    })

    const result = await client.locationsApi.listLocations()
    const locations = result.result?.locations || []

    return Response.json({
      ok: true,
      locations: locations.map(loc => ({
        id: loc.id,
        name: loc.name,
        status: loc.status
      }))
    })
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error.message,
        statusCode: error.statusCode || null,
        squareErrors: error.errors || null
      },
      { status: error.statusCode || 500 }
    )
  }
}

