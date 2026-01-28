#!/bin/bash
# Script to check Vercel logs for Square webhook activity
# Usage: ./scripts/check-vercel-logs.sh

echo "🔍 Checking Vercel logs for Square webhook activity..."
echo ""

# Try to get the latest deployment
LATEST_DEPLOYMENT=$(vercel ls --json 2>/dev/null | jq -r '.[0].url' 2>/dev/null)

if [ -z "$LATEST_DEPLOYMENT" ]; then
  echo "❌ Could not get latest deployment URL"
  echo "   Please run: vercel logs <deployment-url>"
  echo "   Or check Vercel Dashboard: https://vercel.com/dashboard"
  exit 1
fi

echo "📡 Fetching logs from: $LATEST_DEPLOYMENT"
echo ""

# Fetch logs and filter for payment/webhook related entries
vercel logs "$LATEST_DEPLOYMENT" 2>&1 | grep -i -E "payment|webhook|square|location_id|locationId" | head -100

echo ""
echo "✅ Log check complete"
echo ""
echo "💡 To see more logs:"
echo "   vercel logs $LATEST_DEPLOYMENT"
echo ""
echo "💡 To see all recent logs:"
echo "   vercel logs $LATEST_DEPLOYMENT | tail -200"

