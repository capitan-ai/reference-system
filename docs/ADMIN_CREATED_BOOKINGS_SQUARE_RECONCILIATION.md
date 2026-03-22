# Square Reconciliation для admin_created_booking_facts

Опциональный ночной job для сверки нашей классификации NEW/REBOOK с данными Square.

## Назначение

- **Audit layer** — не меняет primary truth (наша БД).
- При ошибке Square: DB-метрики остаются валидными.
- Позволяет находить расхождения и логировать их.

## Поля для добавления в admin_created_booking_facts

| Поле | Тип | Описание |
|------|-----|----------|
| square_classification | TEXT | NEW_CLIENT \| REBOOKING \| UNKNOWN — из Square |
| square_checked_at | TIMESTAMPTZ | Когда последний раз проверяли в Square |
| square_mismatch_flag | BOOLEAN | true если db != square |

## Алгоритм (ночной job)

1. Выбрать facts за последние N дней (например, 35), где `square_checked_at` NULL или старее 24h.
2. Собрать уникальные `customer_id`.
3. Для каждого customer запросить booking history через Square API (с учётом rate limits).
4. Определить Square-классификацию по логике Square (first visit и т.д.).
5. Обновить `square_classification`, `square_checked_at`, `square_mismatch_flag`.
6. Логировать: обработано, errors, retries, mismatches, duration.

## Что логировать

- сколько facts взято в работу;
- сколько уникальных customer_id;
- сколько успешных ответов Square;
- сколько API errors / retries;
- сколько mismatch (db_classification != square_classification);
- длительность job;
- last successful run time.

## Поведение при ошибке

- Square недоступен → DB truth валидна, API показывает DB-метрики.
- Square-блок в UI помечается как stale/unavailable.

## Реализация

Скелет скрипта: `scripts/square-reconcile-admin-created-facts.js`

Для полной реализации нужна интеграция с Square Customers/Bookings API и определение их логики "first visit".
