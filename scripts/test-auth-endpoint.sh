#!/bin/bash
# Test Supabase Auth token refresh endpoint
# This tests if the endpoint is responding (will fail auth without real token, but confirms service is up)

SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-https://fqkrigvliyphjwpokwbl.supabase.co}"
ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY}"

if [ -z "$ANON_KEY" ]; then
  echo "❌ NEXT_PUBLIC_SUPABASE_ANON_KEY is not set"
  echo "   Set it in your .env file or export it"
  exit 1
fi

echo "🔍 Testing Supabase Auth Token Refresh Endpoint"
echo "================================================"
echo "URL: $SUPABASE_URL/auth/v1/token?grant_type=refresh_token"
echo "Anon Key: ${ANON_KEY:0:20}..."
echo ""

# Test with a dummy refresh token (will fail auth but confirms endpoint is up)
curl -i "${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token" \
  -H "apikey: ${ANON_KEY}" \
  -H "Authorization: Bearer ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  --data '{"refresh_token":"test-token-12345"}'

echo ""
echo ""
echo "💡 Note: This test uses a dummy token, so 401/400 is expected."
echo "   If you get 522, the service is down."
echo "   If you get 401/400, the service is up and responding correctly."

