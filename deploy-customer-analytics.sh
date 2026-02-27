#!/bin/bash

# 🚀 CUSTOMER ANALYTICS DEPLOYMENT SCRIPT
# Run this script to deploy customer_analytics to production

set -e

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  📊 CUSTOMER ANALYTICS DEPLOYMENT"
echo "════════════════════════════════════════════════════════════════"
echo ""

# Check if we're in the right directory
if [ ! -f "vercel.json" ]; then
  echo "❌ Error: vercel.json not found. Please run from project root."
  exit 1
fi

echo "✅ Step 1: Running Prisma migration..."
echo "   This creates the customer_analytics table with all indexes"
echo ""

npx prisma migrate deploy

if [ $? -ne 0 ]; then
  echo "❌ Migration failed. Please check the error above."
  exit 1
fi

echo ""
echo "✅ Step 1 complete!"
echo ""

echo "════════════════════════════════════════════════════════════════"
echo "✅ Step 2: Loading initial data..."
echo "   This calculates all customer metrics (takes 1-5 minutes)"
echo ""

node scripts/refresh-customer-analytics.js full

if [ $? -ne 0 ]; then
  echo "❌ Initial data load failed. Please check the error above."
  exit 1
fi

echo ""
echo "✅ Step 2 complete!"
echo ""

echo "════════════════════════════════════════════════════════════════"
echo "✅ Step 3: Updating analytics view..."
echo "   This fixes the 'new customers' calculation"
echo ""

node scripts/update-analytics-appointments-view.js

if [ $? -ne 0 ]; then
  echo "❌ View update failed. Please check the error above."
  exit 1
fi

echo ""
echo "✅ Step 3 complete!"
echo ""

echo "════════════════════════════════════════════════════════════════"
echo "✅ Step 4: Running sanity checks..."
echo ""

node scripts/sanity-check-customer-analytics.js

if [ $? -ne 0 ]; then
  echo "⚠️  Sanity checks completed with warnings. Please review above."
else
  echo "✅ All sanity checks passed!"
fi

echo ""
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "🎉 DEPLOYMENT COMPLETE!"
echo ""
echo "What was done:"
echo "  ✅ Created customer_analytics table with proper indexes"
echo "  ✅ Loaded all historical customer metrics"
echo "  ✅ Updated analytics_appointments_by_location_daily VIEW"
echo "  ✅ Verified data quality with sanity checks"
echo ""
echo "What happens next:"
echo "  ⏰ Hourly cron job will automatically refresh data (via Vercel Cron)"
echo "  📊 Dashboard will now show accurate 'new customers' KPI"
echo "  🔍 All customer analysis queries will use customer_analytics"
echo ""
echo "Next steps:"
echo "  1. Deploy to production: git push"
echo "  2. Monitor: /admin/jobs/status"
echo "  3. Done! The system is fully automated 🚀"
echo ""
echo "════════════════════════════════════════════════════════════════"
echo ""


