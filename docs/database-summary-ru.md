# Краткая сводка по базе данных

## 🗄️ Текущая настройка

**База данных:** PostgreSQL (Neon.tech - serverless)  
**ORM:** Prisma  
**Подключение:** Через `DATABASE_URL` environment variable

## 📊 Основные таблицы

### Клиенты
- **`customers`** (23 записи) - новая система клиентов
- **`square_existing_clients`** (7,265 записей) - legacy система из Square
- ⚠️ **Проблема:** Дублирование данных, нужна синхронизация

### Реферальная программа
- **`ref_links`** (23) - реферальные ссылки
- **`ref_clicks`** (431) - клики по ссылкам
- **`ref_matches`** (4) - совпадения кликов с бронированиями
- **`ref_rewards`** (2) - награды за рефералов

### Подарочные карты
- **`giftcard_jobs`** (4,921) - очередь задач
- **`giftcard_runs`** (4,919) - отслеживание выполнения

### Уведомления
- **`notification_events`** (80) - события отправки SMS/Email

## 🔗 Связи

```
customers
  ├── ref_links (1:1)
  ├── ref_clicks (1:N)
  ├── ref_matches (1:N)
  └── ref_rewards (1:N)
```

## 🎯 Что нужно для дашборда Lovable

### 1. Основные метрики
- Количество клиентов
- Активные рефереры
- Клики и конверсия
- Награды и их статусы
- Статистика подарочных карт
- Статистика уведомлений

### 2. Улучшения базы данных

#### A. Добавить индексы (для быстрых запросов)
```sql
-- Временные индексы
CREATE INDEX idx_customers_created_at ON customers(created_at);
CREATE INDEX idx_ref_clicks_created_at ON ref_clicks(created_at);
CREATE INDEX idx_ref_matches_matched_at ON ref_matches(matched_at);

-- Индексы по статусам
CREATE INDEX idx_ref_links_status ON ref_links(status);
CREATE INDEX idx_ref_rewards_status ON ref_rewards(status);
```

#### B. Создать view для объединения клиентов
```sql
CREATE VIEW unified_customers AS
SELECT 
  COALESCE(c.id, sec.square_customer_id) as id,
  COALESCE(c.email, sec.email_address) as email,
  COALESCE(c.full_name, CONCAT(sec.given_name, ' ', sec.family_name)) as full_name,
  COALESCE(c.created_at, sec.created_at) as created_at
FROM customers c
FULL OUTER JOIN square_existing_clients sec 
  ON c.square_customer_id = sec.square_customer_id;
```

#### C. Материализованные view для статистики
```sql
-- Статистика по дням
CREATE MATERIALIZED VIEW referral_daily_stats AS
SELECT 
  DATE(rc.created_at) as date,
  COUNT(DISTINCT rc.id) as clicks,
  COUNT(DISTINCT rm.id) as matches,
  COUNT(DISTINCT rr.id) as rewards
FROM ref_clicks rc
LEFT JOIN ref_matches rm ON rm.ref_code = rc.ref_code
LEFT JOIN ref_rewards rr ON rr.ref_match_id = rm.id
GROUP BY DATE(rc.created_at);
```

## 📝 Подключение к Lovable

1. **Получить DATABASE_URL** из переменных окружения
2. **В Lovable:** Использовать PostgreSQL connector
3. **Подключить таблицы:**
   - `customers`
   - `ref_links`, `ref_clicks`, `ref_matches`, `ref_rewards`
   - `giftcard_jobs`, `giftcard_runs`
   - `notification_events`
   - `square_existing_clients` (legacy)

## 🚀 Следующие шаги

1. ✅ Изучить структуру (выполнено)
2. ⏳ Создать индексы
3. ⏳ Создать view для объединения данных
4. ⏳ Настроить подключение в Lovable
5. ⏳ Протестировать запросы

---

**Подробная документация:** `docs/database-for-dashboard.md`



