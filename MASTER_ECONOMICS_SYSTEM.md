# Master Economics & Analytics System - Documentation

## 1. Концепция системы
Система представляет собой независимый финансовый слой ("система в системе"), который работает параллельно с основной синхронизацией Square. Она обеспечивает 100% точность расчетов зарплат, защиту исторической правды и детальную аналитику эффективности мастеров.

## 2. Архитектура слоев

### Слой 1: Snapshot Layer (Фундамент)
**Триггер:** Вебхук `booking.created` или `booking.updated` со статусом `ACCEPTED`.
**Действие:** Создание записи в `BookingSnapshot`.
**Данные для сохранения:**
- `price_amount`: Базовая цена из `catalog_variations` или `MasterSettings`.
- `commission_rate`: Текущий % мастера из `MasterSettings`.
- `category`: Роль мастера (TOP/MASTER/JUNIOR) из `MasterSettings`.
- `duration_minutes`: Длительность из `Booking`.

### Слой 2: Master Engine (Финансовое сердце)
**Триггер:** Появление в БД консистентной цепочки: `Booking (ACCEPTED)` + `Order (COMPLETED)` + `Payment (COMPLETED)`.
**Действие:** Расчет базового дохода и запись в `MasterEarningsLedger`.

### Слой 3: Discount Engine (Корректировки)
**Триггер:** Завершение работы Master Engine (`base_processed = true`).
**Действие:** Анализ скидок в `OrderLineItem` и применение `DiscountAllocationRule`.

### Слой 4: Analytics Layer (Dashboard)
**Триггер:** Расписание (Cron) каждые 1–5 минут.
**Действие:** Агрегация данных из Ledger и Snapshots в таблицу `MasterPerformanceDaily`.

---

## 3. Лог выполнения (Execution Log)

### [2026-03-04] Шаг 1: Подготовка БД
- Созданы таблицы: `BookingSnapshot`, `MasterEarningsLedger`, `MasterPerformanceDaily`, `CustomerPackage`, `PackageUsage`, `DiscountAllocationRule`.
- Создана таблица `MasterSettings` и заполнена данными мастеров (роли и проценты).
- База данных синхронизирована.

### [2026-03-04] Шаг 2: Внедрение Snapshot Logic
- Создан сервис `lib/workers/master-snapshot-service.js`.
- Интегрирован вызов `upsertBookingSnapshot` в `app/api/webhooks/square/webhook-processors.js`.
- Теперь каждая новая запись автоматически создает финансовый снепшот.

### [В процессе] Шаг 2.1: Backfill (Заполнение истории за февраль)
- Цель: Создать снепшоты для всех записей за февраль 2026 года.

### [2026-03-04] Шаг 2.1: Backfill (Заполнение истории за февраль)
- Статус: ✅ Завершено.
- Результат: Создано/обновлено **1117** финансовых снепшотов.
- Пропущено: **150** записей (в основном из-за отсутствия technician_id или настроек для системных аккаунтов).
- Логика: Снепшоты зафиксировали цену из каталога и процент мастера на момент февраля.

### [2026-03-04] Шаг 3: Разработка Master Earnings Worker
- **Статус:** ✅ Код воркера готов (`lib/workers/master-earnings-worker.js`).
- **Реализованная логика:**
  - **Агрегация платежей:** Система суммирует чаевые и оплаты из всех транзакций по одному заказу (поддержка Split Payments и Gift Cards).
  - **Package Engine:** Если цена в заказе 0$ или есть скидка "Package", воркер ищет активный абонемент клиента в `CustomerPackage` и берет `allocated_unit_price` для расчета комиссии.
  - **Автоматическое списание:** При использовании пакета количество оставшихся визитов уменьшается автоматически.
  - **Ledger Integration:** Все начисления записываются в `MasterEarningsLedger` одной транзакцией.
- **Тестирование:** Проведен Dry Run на 100 записях, подтвердивший корректность расчетов для обычных визитов и чаевых.
