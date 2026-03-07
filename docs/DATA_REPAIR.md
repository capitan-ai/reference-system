# Data Repair & Backfills

Guide for safely correcting historical data inconsistencies and running manual syncs.

## 🛠 Available Scripts
The `/scripts` folder contains specialized tools for data recovery.

| Script | Purpose | When to Use |
| :--- | :--- | :--- |
| `final_referral_backfill.js` | Syncs missing rewards. | Use if rewards were sent via email but not saved to DB. |
| `global_referral_scan.js` | Forensic code recovery. | Use to find referral codes hidden in Square Custom Attributes. |
| `fix_stuck_orders.js` | Re-links orders to bookings. | Use if technician names are missing from sales reports. |
| `sync_all_stuck_orders.js` | Bulk order/payment sync. | Use after a prolonged Square API outage. |

## 🛡 Safe Change Procedure

### 1. Dry Run First
Most scripts include a "Dry Run" mode or log their intentions before executing. Always check the console output before committing changes to the database.

### 2. Backup Target Table
Before running a bulk `UPDATE` or `DELETE`, export the current state:
```sql
COPY (SELECT * FROM referral_rewards) TO '/tmp/referral_rewards_backup.csv' WITH CSV HEADER;
```

### 3. Verify After Execution
After running a backfill, verify the results using a count query:
```sql
SELECT status, COUNT(*) FROM referral_rewards GROUP BY status;
```

## 🔄 Common Backfill Scenarios

### Recovering Missing Referral Codes
If customers booked directly via Square and their codes weren't captured:
1.  Run `scripts/global_referral_scan.js` to generate a manifest.
2.  Run `scripts/filter_our_referrals.js` to remove non-system codes.
3.  Run `scripts/final_referral_backfill.js` to populate the rewards table.

### Recalculating Master Earnings
If a commission rate was wrong for a specific period:
1.  Identify the affected `BookingSnapshot` records.
2.  Set `base_processed = false` for those records.
3.  The next run of the `master-earnings` cron will recalculate them using the **current** commission rate.
    *Warning: This will create duplicate ledger entries unless you manually delete the old ones first.*

## 🆘 Emergency Data Repair
If the `application_logs` table grows too large and slows down the DB:
```sql
DELETE FROM application_logs WHERE created_at < NOW() - INTERVAL '30 days';
```
*(Keep at least 30 days for audit purposes).*

