#!/bin/bash
# Test REST API with curl (hits database)
# Usage: ./scripts/test-rest-api-curl.sh [anon_key] [service_key]

SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-https://fqkrigvliyphjwpokwbl.supabase.co}"
ANON_KEY="${1:-${NEXT_PUBLIC_SUPABASE_ANON_KEY}}"
SERVICE_KEY="${2:-${SUPABASE_SERVICE_ROLE_KEY}}"

API_KEY="${SERVICE_KEY:-${ANON_KEY}}"

if [ -z "$API_KEY" ]; then
  echo "❌ No API key provided!"
  echo ""
  echo "Usage:"
  echo "  ./scripts/test-rest-api-curl.sh <anon_key>"
  echo "  ./scripts/test-rest-api-curl.sh <anon_key> <service_key>"
  echo ""
  echo "Or set environment variables:"
  echo "  export NEXT_PUBLIC_SUPABASE_ANON_KEY=your_key"
  echo "  export SUPABASE_SERVICE_ROLE_KEY=your_key"
  exit 1
fi

echo "🔍 Testing Database via REST API"
echo "================================================"
echo "URL: ${SUPABASE_URL}/rest/v1/"
echo "Key: ${API_KEY:0:20}..."
echo ""

echo "📡 Making request..."
curl -i "${SUPABASE_URL}/rest/v1/" \
  -H "apikey: ${API_KEY}" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Accept: application/json"

echo ""
echo ""
echo "💡 Interpretation:"
echo "   • 200 / 404 / JSON error → Database is ALIVE (path works)"
echo "   • 5xx / timeout / 522 → Database path is broken"
echo "   • 401 / 403 → Authentication issue (but service is responding)"

