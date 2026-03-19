# Master Analytics — Roadmap

План доработок для аналитики мастеров. **Статус: реализовано (2026-03-19).**

---

## 1. available_minutes и utilization_rate

### Текущее состояние
- `available_minutes` и `utilization_rate` всегда 0
- В `MasterSettings` нет полей для рабочих часов

### Варианты источника available_minutes

| Вариант | Сложность | Описание |
|--------|-----------|----------|
| **A. Дефолт в MasterSettings** | Низкая | Добавить `default_working_minutes_per_day` (например 480) |
| **B. Таблица master_schedule** | Средняя | `(team_member_id, day_of_week, start_minutes, end_minutes)` |
| **C. Square Team Member API** | Высокая | Рабочие смены из Square (если есть) |

### Рекомендуемый план

**Фаза 1 (MVP):**
1. Добавить в `MasterSettings` поле `default_working_minutes_per_day Int?` (nullable, default 480)
2. В `refresh-master-performance.js`: брать `COALESCE(ms.default_working_minutes_per_day, 480)` для расчёта
3. `utilization_rate = CASE WHEN available_minutes > 0 THEN LEAST(1.0, booked_minutes::float / available_minutes) ELSE 0 END`

**Фаза 2 (опционально):**
- Таблица `master_schedule` для точных расписаний по дням недели
- Миграция + backfill из настроек салона

### Файлы для изменения
- `prisma/schema.prisma` — поле в MasterSettings
- `scripts/refresh-master-performance.js` — JOIN с MasterSettings, расчёт available_minutes и utilization_rate

---

## 2. composite_score

### Текущее состояние
- `composite_score` всегда 0

### Формула (предложение)

```
composite_score = w1 * revenue_score + w2 * utilization_score + w3 * retention_score
```

Где:
- **revenue_score (0–100)**: нормализация `net_master_income` по перцентилю среди мастеров за период
- **utilization_score (0–100)**: `utilization_rate * 100` (уже 0–100)
- **retention_score (0–100)**: доля rebookings vs new clients (или из customer_analytics)

**Упрощённая формула для MVP:**
```
composite_score = (revenue_percentile * 0.5) + (utilization_rate * 100 * 0.3) + (rebook_ratio * 100 * 0.2)
```

### План
1. Определить финальную формулу и веса (согласовать с бизнесом)
2. В `refresh-master-performance.js` добавить CTE для расчёта перцентилей по org+date
3. Вычислять `composite_score` в финальном SELECT

### Файлы для изменения
- `scripts/refresh-master-performance.js` — логика расчёта composite_score

---

## 3. location_id в master_performance_daily

### Проблема
- `ledger_agg` не учитывает `location_id` (группировка по date, master_id, organization_id)
- При работе мастера в нескольких локациях в один день берётся `MAX(location_id)` — одна локация на день

### Варианты

| Вариант | Изменения | Плюсы | Минусы |
|---------|-----------|-------|--------|
| **A. Одна строка на мастера/день** | Оставить как есть | Просто, без миграций | Нет разбивки по локациям |
| **B. Строка на (date, master_id, location_id)** | PK → (date, master_id, location_id) | Полная разбивка по локациям | Миграция, переписывание refresh |

### Рекомендуемый план (вариант B)

**Шаг 1: Миграция схемы**
- Изменить PK `master_performance_daily` на `(date, master_id, location_id)`
- Добавить индекс `(organization_id, location_id, date)`

**Шаг 2: Обновить ledger_agg**
- Ledger не содержит `location_id`, но есть `booking_id` → можно взять `location_id` из `booking_snapshots` или `bookings`
- Добавить в Ledger поле `location_id` (опционально) или джойнить через snapshot/booking при агрегации

**Шаг 3: Обновить booking_agg**
- Группировать по `(date, master_id, location_id)` вместо `(date, master_id)` с `MAX(location_id)`
- Для ledger: джойнить ledger → snapshot → booking для получения location_id, группировать по location_id

**Шаг 4: Обновить keys и финальный INSERT**
- `keys` = UNION из booking_agg (уже по location) + ledger_agg с location (через join)
- ON CONFLICT (date, master_id, location_id)

### Файлы для изменения
- `prisma/schema.prisma` — изменить @@id в MasterPerformanceDaily
- `prisma/migrations/` — новая миграция
- `scripts/refresh-master-performance.js` — полная переработка CTE с учётом location_id

---

## 4. Discount Engine

### Текущее состояние
- Таблица `discount_allocation_rules` есть
- В `BookingSnapshot` есть `discount_processed`
- В `master-earnings-worker.js` скидки не обрабатываются

### Логика Discount Engine

**Триггер:** после `base_processed = true` в BookingSnapshot.

**Алгоритм:**
1. Найти Order по booking_id
2. Для каждого OrderLineItem с `discount_name` и `total_discount_money_amount > 0`:
   - Найти правило в `DiscountAllocationRule` по `(organization_id, discount_name)`
   - `master_share = total_discount_money_amount * (master_share_percent / 100)`
   - Создать запись в Ledger: `entry_type = 'DISCOUNT_ADJUSTMENT'`, `amount_amount = -master_share` (отрицательное)
3. Установить `discount_processed = true` в BookingSnapshot

### План

**Шаг 1: Discount Engine Worker**
- Создать `lib/workers/discount-engine-worker.js`
- Функция `processDiscountAdjustments(organizationId)`:
  - Выбрать snapshots с `base_processed = true` и `discount_processed = false`
  - Для каждого: Order → OrderLineItems с discount → DiscountAllocationRule → Ledger

**Шаг 2: Интеграция в Master Earnings Worker**
- После `processMasterEarnings` вызывать `processDiscountAdjustments`
- Или добавить вызов в cron `master-earnings` после `processMasterEarnings`

**Шаг 3: Backfill**
- Скрипт для обработки исторических snapshots с необработанными скидками

### Файлы для создания/изменения
- `lib/workers/discount-engine-worker.js` — новый файл
- `lib/workers/master-earnings-worker.js` — опционально: вызов discount engine после base processing
- `app/api/cron/master-earnings/route.js` — добавить вызов `processDiscountAdjustments`
- `scripts/backfill-discount-adjustments.js` — backfill (опционально)

---

## Порядок выполнения

| # | Задача | Зависимости | Приоритет |
|---|--------|-------------|-----------|
| 1 | available_minutes + utilization_rate (дефолт 480) | — | Высокий |
| 2 | composite_score (упрощённая формула) | #1 | Средний |
| 3 | Discount Engine | — | Высокий |
| 4 | location_id (разбивка по локациям) | — | Средний |

**Рекомендуемая последовательность:**
1. **Discount Engine** — влияет на корректность Ledger и зарплат
2. **available_minutes + utilization_rate** — быстрый MVP
3. **composite_score** — после utilization
4. **location_id** — при необходимости отчётов по локациям

---

## Чеклист (выполнено)

- [x] Согласовать формулу composite_score (revenue percentile 0.5 + utilization 0.5)
- [x] Разбивка по локациям (PK: date, master_id, location_id)
- [ ] Заполнить `discount_allocation_rules` для существующих скидок (ручная настройка)
- [ ] Проверить наличие `discount_name` в OrderLineItem для реальных заказов
