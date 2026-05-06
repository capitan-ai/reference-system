#!/bin/bash

set -e

# Load env vars
export $(grep -E 'TELEGRAM_|DATABASE_URL|ZORINA_ORG_ID' /Users/umitrakhimbekova/Documents/Zorina/reference-system/.env | xargs)

BOT_TOKEN="$TELEGRAM_BOT_TOKEN"
CHAT_ID="$TELEGRAM_CHAT_ID"
ORG_ID="$ZORINA_ORG_ID"
DB_URL="$DATABASE_URL"

TIMESTAMP=$(date +%Y-%m-%d)
EXCEL_FILE="/tmp/feedback-report-${TIMESTAMP}.xlsx"

echo "📊 Generating Excel report..."

# Create a Python script to generate Excel
python3 << 'PYTHON_EOF'
import os
import sys
from datetime import datetime
import psycopg2
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

# Database connection
conn_str = os.environ.get('DATABASE_URL')
conn = psycopg2.connect(conn_str)
cursor = conn.cursor()

org_id = os.environ.get('ZORINA_ORG_ID')

# Fetch statistics
cursor.execute("""
SELECT
  COUNT(*) as total,
  ROUND(AVG(NULLIF(rating, 0))::numeric, 1) as avg_rating,
  COUNT(CASE WHEN rating = 5 THEN 1 END) as r5,
  COUNT(CASE WHEN rating = 4 THEN 1 END) as r4,
  COUNT(CASE WHEN rating = 3 THEN 1 END) as r3,
  COUNT(CASE WHEN rating = 2 THEN 1 END) as r2,
  COUNT(CASE WHEN rating = 1 THEN 1 END) as r1
FROM customer_feedback
WHERE organization_id = %s
""", (org_id,))

total, avg_rating, r5, r4, r3, r2, r1 = cursor.fetchone()

# Fetch detailed feedback
cursor.execute("""
SELECT
  customer_name,
  master_name,
  location_name,
  rating,
  SUBSTRING(COALESCE(improve_text, ''), 1, 50) as note,
  TO_CHAR(submitted_at AT TIME ZONE 'America/Los_Angeles', 'MM-DD HH:MM') as time,
  source,
  ARRAY_TO_STRING(COALESCE(issues, ARRAY[]::text[]), ', ') as issues
FROM customer_feedback
WHERE organization_id = %s
ORDER BY submitted_at DESC
LIMIT 100;
""", (org_id,))

feedback_rows = cursor.fetchall()
cursor.close()
conn.close()

# Create workbook
wb = openpyxl.Workbook()

# === Sheet 1: Summary ===
ws_summary = wb.active
ws_summary.title = "Summary"

title_font = Font(name='Calibri', size=16, bold=True, color='FFFFFF')
title_fill = PatternFill(start_color='366092', end_color='366092', fill_type='solid')
header_font = Font(name='Calibri', size=11, bold=True, color='FFFFFF')
header_fill = PatternFill(start_color='4472C4', end_color='4472C4', fill_type='solid')
data_font = Font(name='Calibri', size=11)

# Title
ws_summary['A1'] = '📊 Feedback Daily Report'
ws_summary['A1'].font = Font(name='Calibri', size=14, bold=True)
ws_summary.merge_cells('A1:B1')

# Summary section
row = 3
ws_summary[f'A{row}'] = 'Total Feedback'
ws_summary[f'B{row}'] = total
ws_summary[f'A{row}'].font = Font(bold=True)

row += 1
ws_summary[f'A{row}'] = 'Average Rating'
ws_summary[f'B{row}'] = f"{avg_rating} / 5"
ws_summary[f'A{row}'].font = Font(bold=True)

# Rating distribution
row += 2
ws_summary[f'A{row}'] = 'Rating Distribution'
ws_summary[f'A{row}'].font = Font(bold=True, size=12)

row += 1
distribution = [('5 ⭐', r5), ('4 ⭐', r4), ('3 ⭐', r3), ('2 ⭐', r2), ('1 ⭐', r1)]
for label, count in distribution:
    ws_summary[f'A{row}'] = label
    ws_summary[f'B{row}'] = count
    ws_summary[f'A{row}'].font = Font(bold=True)
    row += 1

# Column widths
ws_summary.column_dimensions['A'].width = 25
ws_summary.column_dimensions['B'].width = 20

# === Sheet 2: Detailed Feedback ===
ws_detail = wb.create_sheet('Detailed Feedback')

# Header row
headers = ['#', 'Customer Name', 'Master Name', 'Location', 'Rating', 'Date & Time', 'Comment', 'Source', 'Issues']
for col_num, header in enumerate(headers, 1):
    cell = ws_detail.cell(row=1, column=col_num)
    cell.value = header
    cell.font = header_font
    cell.fill = header_fill
    cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)

# Set column widths
widths = [5, 18, 18, 18, 10, 15, 30, 15, 25]
for col_num, width in enumerate(widths, 1):
    ws_detail.column_dimensions[get_column_letter(col_num)].width = width

# Data rows
for row_num, row_data in enumerate(feedback_rows, 2):
    customer, master, location, rating, note, time, source, issues = row_data

    cells_data = [
        (row_num - 1, 'center'),
        (customer or '', 'left'),
        (master or '', 'left'),
        (location or '', 'left'),
        ('⭐' * (int(rating) if rating else 0), 'center'),
        (time or '', 'center'),
        (note or '', 'left'),
        (source or '', 'left'),
        (issues or '', 'left')
    ]

    for col_num, (value, align) in enumerate(cells_data, 1):
        cell = ws_detail.cell(row=row_num, column=col_num)
        cell.value = value
        cell.font = data_font
        cell.alignment = Alignment(horizontal=align, vertical='top', wrap_text=True)

        # Alternate row colors
        if row_num % 2 == 0:
            cell.fill = PatternFill(start_color='E7E6E6', end_color='E7E6E6', fill_type='solid')

# Freeze first row
ws_detail.freeze_panes = 'A2'

# Save file
timestamp = datetime.now().strftime('%Y-%m-%d')
filename = f'/tmp/feedback-report-{timestamp}.xlsx'
wb.save(filename)

print(f"✅ Excel file created: {filename}")
sys.exit(0)
PYTHON_EOF

if [ $? -eq 0 ]; then
  echo "📤 Uploading to Telegram..."

  # Send to Telegram
  curl -s -F "document=@${EXCEL_FILE}" \
       -F "chat_id=${CHAT_ID}" \
       -F "caption=📊 Daily Feedback Report" \
       "https://api.telegram.org/bot${BOT_TOKEN}/sendDocument" | grep -q '"ok":true'

  if [ $? -eq 0 ]; then
    echo "✅ Excel report sent to Telegram successfully!"
    ls -lh "${EXCEL_FILE}"
  else
    echo "❌ Failed to send to Telegram"
    exit 1
  fi
else
  echo "❌ Failed to generate Excel file"
  exit 1
fi
