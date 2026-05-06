#!/bin/bash

set -e

BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-8344843875:AAGL61nDi2fcxx8p7tuzyNkt1qqdFcFGVro}"
CHAT_ID="${TELEGRAM_CHAT_ID:--5132298285}"
ORG_ID="${ZORINA_ORG_ID:-d0e24178-2f94-4033-bc91-41f22df58278}"
DB_URL="${DATABASE_URL}"

if [ -z "$DB_URL" ]; then
  echo "❌ DATABASE_URL not set"
  exit 1
fi

echo "📊 Generating feedback report..."

# Create temp file for data
TMPFILE=$(mktemp)
trap "rm -f $TMPFILE" EXIT

# Query database
psql "$DB_URL" -t -A -F'|' > "$TMPFILE" << 'SQLEOF'
WITH stats AS (
  SELECT
    COUNT(*) as total,
    ROUND(AVG(NULLIF(rating, 0))::numeric, 1) as avg_rating,
    COUNT(CASE WHEN rating = 5 THEN 1 END) as r5,
    COUNT(CASE WHEN rating = 4 THEN 1 END) as r4,
    COUNT(CASE WHEN rating = 3 THEN 1 END) as r3,
    COUNT(CASE WHEN rating = 2 THEN 1 END) as r2,
    COUNT(CASE WHEN rating = 1 THEN 1 END) as r1
  FROM customer_feedback
  WHERE organization_id = 'd0e24178-2f94-4033-bc91-41f22df58278'
)
SELECT
  'STATS|' || total || '|' || avg_rating || '|' || r5 || '|' || r4 || '|' || r3 || '|' || r2 || '|' || r1
FROM stats;
SQLEOF

# Parse stats
STATS=$(grep "^STATS" "$TMPFILE" | cut -d'|' -f2-)
IFS='|' read -r TOTAL AVG_RATING R5 R4 R3 R2 R1 <<< "$STATS"

echo "Found $TOTAL feedback entries"

# Get recent feedback
psql "$DB_URL" -t -A -F'|' > "$TMPFILE" << SQLEOF
SELECT
  customer_name, master_name, location_name, rating,
  SUBSTRING(improve_text, 1, 40) as note,
  TO_CHAR(submitted_at AT TIME ZONE 'America/Los_Angeles', 'MM-DD HH:MM') as time
FROM customer_feedback
WHERE organization_id = '$ORG_ID'
ORDER BY submitted_at DESC
LIMIT 12;
SQLEOF

# Build message
MESSAGE="<b>📊 Feedback Daily Report</b>

<b>Statistics:</b>
📈 Total: <b>$TOTAL</b> feedback
⭐ Avg Rating: <b>$AVG_RATING</b>/5

<b>Rating Distribution:</b>
5⭐ $R5  │  4⭐ $R4  │  3⭐ $R3  │  2⭐ $R2  │  1⭐ $R1

<b>Recent Feedback:</b>
"

LINE=1
while IFS='|' read -r CNAME TNAME LNAME RATING NOTE TIME; do
  if [ -z "$CNAME" ]; then continue; fi
  STARS=$(printf '⭐%.0s' $(seq 1 ${RATING:-0}))
  CNAME_SHORT=$(echo "$CNAME" | cut -c1-15)
  TNAME_SHORT=$(echo "$TNAME" | cut -c1-15)
  LNAME_SHORT=$(echo "$LNAME" | cut -c1-12)
  NOTE_SHORT=$(echo "${NOTE:-no note}" | cut -c1-30)

  MESSAGE+="
$LINE. <b>$CNAME_SHORT</b> @ $LNAME_SHORT [$TIME]
   $STARS $TNAME_SHORT"

  [ -n "$NOTE_SHORT" ] && MESSAGE+="
   💬 $NOTE_SHORT"

  LINE=$((LINE + 1))
done < "$TMPFILE"

# Send to Telegram
echo "📤 Sending to Telegram..."

RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d @- << JSONEOF
{
  "chat_id": $CHAT_ID,
  "text": $(printf '%s' "$MESSAGE" | jq -Rs .),
  "parse_mode": "HTML"
}
JSONEOF
)

if echo "$RESPONSE" | grep -q '"ok":true'; then
  echo "✅ Report sent successfully to Telegram!"
else
  echo "❌ Failed to send to Telegram:"
  echo "$RESPONSE"
  exit 1
fi
