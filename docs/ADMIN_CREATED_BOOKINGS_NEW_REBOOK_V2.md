# План v2: New vs Rebook по букингам, созданным админом

Полный технический план. Контракт метрики: [ADMIN_CREATED_BOOKINGS_NEW_REBOOK_CONTRACT.md](./ADMIN_CREATED_BOOKINGS_NEW_REBOOK_CONTRACT.md).

---

## 1. Цель

Добавить в аналитику по администраторам метрики для **букингов, созданных админом**:

- сколько всего букингов создано;
- сколько из них **new client**;
- сколько **rebook**;
- сколько визитов приходятся на **тот же месяц**;
- сколько — на **следующие месяцы**;
- сколько — на **прошлые месяцы** (backdated);
- опционально — результаты ночной сверки с Square.

Ключевое требование: метрика **стабильная, объяснимая, пересчитываемая**, не меняется ретроактивно из-за появления будущих букингов.

---

## 2. Primary truth = наша БД

Square используется только как reconciliation/audit layer, не как источник для ежедневного расчёта.

---

## 3. Модель данных

### 3.1. admin_created_booking_facts (booking-level)

Таблица фактов на уровне букинга:

| Поле | Тип | Описание |
|------|-----|----------|
| booking_id | UUID | PK |
| organization_id | UUID | |
| location_id | UUID | |
| customer_id | VARCHAR | |
| administrator_id_snapshot | UUID | **IMMUTABLE** |
| administrator_name_snapshot | TEXT | **IMMUTABLE** |
| creator_type_snapshot | TEXT | **IMMUTABLE** |
| creator_resolution_source | TEXT | **IMMUTABLE** |
| created_at_utc | TIMESTAMPTZ | **IMMUTABLE** |
| start_at_utc | TIMESTAMPTZ | **IMMUTABLE** |
| created_day_pacific | DATE | **IMMUTABLE** |
| visit_day_pacific | DATE | **IMMUTABLE** |
| created_month_pacific | DATE | **IMMUTABLE** |
| visit_month_pacific | DATE | **IMMUTABLE** |
| classification_snapshot | TEXT | NEW_CLIENT \| REBOOKING — **Mutable** в correction window |
| classification_reason_snapshot | TEXT | NO_PRIOR_PAID \| HAS_PRIOR_PAID — **Mutable** |
| prior_paid_exists | BOOLEAN | **Mutable** |
| is_same_month | BOOLEAN | visit_month = created_month |
| is_future_month | BOOLEAN | visit_month > created_month |
| is_past_month | BOOLEAN | visit_month < created_month |
| snapshot_calculated_at | TIMESTAMPTZ | **Mutable** |

### 3.2. admin_analytics_daily (агрегаты)

Колонки, заполняемые из facts:

- `bookings_created_count` — из created_agg
- `new_customers_booked_count` — из admin_created_facts_agg (NEW_CLIENT)
- `rebookings_count` — из admin_created_facts_agg (REBOOKING)
- `bookings_created_same_month_count` — из facts (is_same_month)
- `bookings_created_future_months_count` — из facts (is_future_month)
- `bookings_created_past_month_count` — из facts (is_past_month)

---

## 4. Логика расчёта

### 4.1. Prior paid

**Prior paid** = у клиента есть хотя бы один `Payment` со статусом `COMPLETED`, связанный с букингом, который по порядку `(start_at, created_at, booking_id)` идёт **раньше** текущего.

### 4.2. Snapshot policy

- **INSERT** (новый букинг): полный snapshot, все поля.
- **UPDATE** (существующий, в correction window): только `classification_snapshot`, `classification_reason_snapshot`, `prior_paid_exists`, `snapshot_calculated_at`, `updated_at`.
- **Immutable** поля никогда не перезаписываются.

### 4.3. Correction window

35 дней. Для записей старше — classification не обновляется.

---

## 5. Порядок реализации (выполнено)

| Phase | Описание | Статус |
|-------|----------|--------|
| 0 | Контракт в docs | ✅ |
| 1 | Миграция admin_created_booking_facts | ✅ |
| 2 | Модуль lib/analytics/admin-created-booking-facts.js | ✅ |
| 3 | Backfill скрипт | ✅ |
| 4 | Интеграция в refresh (API, cron, manual) | ✅ |
| 5 | Метрики same_month / future_months / past_month | ✅ |
| 6 | Square reconciliation (опционально) | Скелет + docs/ADMIN_CREATED_BOOKINGS_SQUARE_RECONCILIATION.md |
| 7 | Обновление audit-скриптов | ✅ |

---

## 6. Square reconciliation (опционально)

Ночной job для сверки с Square:

1. Выбрать facts без свежей Square-проверки (последние 35 дней).
2. Для каждого customer_id запросить booking history через Square API.
3. Определить Square-классификацию (NEW/REBOOK по логике Square).
4. Обновить `square_classification`, `square_checked_at`, `square_mismatch_flag` в facts.
5. Логировать: обработано, errors, mismatches, duration.

При ошибке Square: DB truth остаётся валидной, API показывает DB-метрики.

---

## 7. Скрипты и команды

```bash
# Backfill facts
node scripts/backfill-admin-created-booking-facts.js --days=35

# Refresh admin analytics
node scripts/manual-refresh-admin-analytics.js --days=35

# Verify
node scripts/verify-new-client-rebooking-counts.js 14
```

---

## 8. Связанные документы

- [ADMIN_CREATED_BOOKINGS_NEW_REBOOK_CONTRACT.md](./ADMIN_CREATED_BOOKINGS_NEW_REBOOK_CONTRACT.md) — контракт метрики
- [ADMIN_SCORECARD_REFRESH.md](./ADMIN_SCORECARD_REFRESH.md) — как обновлять Scorecard
