# Master Analytics — Full Audit Report

**Дата:** 2026-03-19

---

## 1. Резюме

| Метрика | Текущее значение | Ожидаемое | Статус |
|---------|-----------------|-----------|--------|
| Ledger commission | $81,656 | ~$1,000,000+ | ❌ Недостаточно |
| Ledger tips | $30,806 | ~$300,000+ | ❌ Недостаточно |
| Обработано snapshots | 1,655 | 31,828 | ❌ 5% |
| Ожидают обработки | 30,173 | 0 | ❌ |

**Причина:** 26,000+ snapshots с order+payment не обработаны Master Earnings Worker. Cron обрабатывает 50 за раз каждый час — для полной обработки нужно ~530 прогонов (~22 дня).

---

## 2. Найденные проблемы

### 2.1 Устаревшие строки в master_performance_daily (ИСПРАВЛЕНО)

**Проблема:** После смены PK на (date, master_id, location_id) остались строки со старыми данными, которые не перезаписывались. Суммы были завышены (11.4M vs 8.2M в ledger).

**Решение:** Добавить `DELETE FROM master_performance_daily WHERE organization_id = ?` перед INSERT в refresh.

### 2.2 Дата в Ledger (ИСПРАВЛЕНО ранее)

Использовалась `created_at` вместо `start_at` — комиссия попадала в день обработки, а не день услуги.

### 2.3 Огромный бэклог snapshots

- **30,173** snapshots с `base_processed = false`
- **26,329** из них имеют: completed order + completed payment + technician_id
- Worker обрабатывает **50 за раз** (take: 50)
- При hourly cron: **~22 дня** для полной обработки

**Рекомендация:** Запустить `scripts/backfill-master-earnings.js` для массовой обработки (многократные прогоны в цикле).

---

## 3. Проверка данных после исправлений

После DELETE + refresh:
- `SUM(net_master_income)` = Ledger commission ✓
- `SUM(tips_total)` = Ledger tips ✓
- `SUM(gross_generated)` ≈ snapshot total ✓

---

## 4. Рекомендуемые действия

1. **Добавить DELETE в refresh** — очищать таблицу перед вставкой для org
2. **Запустить backfill** — `node scripts/backfill-master-earnings.js` для обработки всех pending snapshots
3. **Backfill:** по умолчанию batch 1500, concurrency 15; env `EARNINGS_BATCH_SIZE`, `EARNINGS_CONCURRENCY`, `DISCOUNT_BATCH_SIZE`, `DISCOUNT_CONCURRENCY`

---

## 5. Источники данных

| Таблица | Назначение |
|---------|------------|
| `booking_snapshots` | Цена, %, technician — триггер для Ledger |
| `master_earnings_ledger` | Commission, tips, discount adjustments |
| `master_performance_daily` | Агрегат по (date, master_id, location_id) |
| `master_settings` | default_working_minutes_per_day |

**Цепочка:** Booking (ACCEPTED) → Snapshot → Order (COMPLETED) + Payment (COMPLETED) → Ledger → master_performance_daily
