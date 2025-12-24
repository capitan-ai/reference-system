const {
  authorizeAdminRequest,
  validateAdminKeyInput,
  createAdminSessionCookie,
  buildExpiredSessionCookie,
} = require('../../../../lib/admin-auth')

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  })
}

export async function GET(request) {
  const auth = await authorizeAdminRequest(request)
  if (!auth.authorized) {
    return json({ authorized: false, error: auth.error }, auth.status || 401)
  }
  return json({ authorized: true, method: auth.method || 'unknown' })
}

export async function POST(request) {
  let body = {}
  try {
    body = await request.json()
  } catch (error) {
    // ignore – handled below
  }

  const validation = validateAdminKeyInput(body.adminKey)
  if (!validation.valid) {
    return json({ success: false, error: validation.error }, validation.status)
  }

  try {
    const cookie = createAdminSessionCookie()
    return json(
      { success: true },
      200,
      {
        'Set-Cookie': cookie,
      },
    )
  } catch (error) {
    return json({ success: false, error: error.message }, 500)
  }
}

export async function DELETE() {
  return json(
    { success: true },
    200,
    {
      'Set-Cookie': buildExpiredSessionCookie(),
    },
  )
}

