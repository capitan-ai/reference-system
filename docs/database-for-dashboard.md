# Анализ базы данных для подключения к дашборду Lovable

## 📊 Текущая конфигурация базы данных

### Технологии
- **База данных:** PostgreSQL
- **ORM:** Prisma
- **Провайдер:** Neon.tech (serverless PostgreSQL)
- **Подключение:** Через `DATABASE_URL` environment variable

### Структура подключения
- Файл конфигурации: `lib/prisma-client.js`
- Схема: `prisma/schema.prisma`
- Используется Neon adapter для оптимизации serverless подключений

---

## 🗄️ Основные таблицы для дашборда

### 1. **customers** (23 записи) - Основная таблица клиентов
**Назначение:** Современная система клиентов

**Ключевые поля:**
- `id` (UUID) - уникальный идентификатор
- `squareCustomerId` - ID клиента в Square
- `email` - email клиента
- `phoneE164` - телефон в формате E164
- `firstName`, `lastName`, `fullName` - имя клиента
- `firstPaidSeen` - флаг первого платежа
- `createdAt` - дата создания

**Связи:**
- `RefLinks` (1:1) - реферальная ссылка
- `RefClicks` (1:N) - клики по реферальным ссылкам
- `RefMatches` (1:N) - совпадения рефералов
- `RefRewards` (1:N) - награды (как реферер и как друг)

**Для дашборда:**
- Общее количество клиентов
- Новые клиенты за период
- Клиенты с первым платежом
- Клиенты с реферальными ссылками

---

### 2. **square_existing_clients** (7,265 записей) - Legacy таблица клиентов
**Назначение:** Основная таблица клиентов из Square (legacy система)

**Ключевые поля:**
- `square_customer_id` - ID клиента в Square
- `given_name`, `family_name` - имя и фамилия
- `email_address`, `phone_number` - контакты
- `referral_code`, `personal_code` - реферальные коды
- `total_referrals` - общее количество рефералов
- `total_rewards` - общее количество наград
- `activated_as_referrer` - активирован как реферер
- `first_payment_completed` - первый платеж завершен
- `gift_card_id` - ID подарочной карты
- `created_at`, `updated_at` - даты

**Для дашборда:**
- Основная статистика по клиентам
- Реферальная активность
- Статистика наград
- Активация рефереров

**⚠️ Проблема:** Дублирование данных с таблицей `customers`. Нужна синхронизация.

---

### 3. **ref_links** (23 записи) - Реферальные ссылки
**Назначение:** Реферальные ссылки клиентов

**Ключевые поля:**
- `id` (UUID)
- `customerId` - ID клиента
- `refCode` - уникальный реферальный код
- `url` - реферальная ссылка
- `status` - статус (NOT_ISSUED, ACTIVE, REVOKED)
- `issuedAt`, `createdAt` - даты

**Связи:**
- `Customer` (N:1)

**Для дашборда:**
- Количество активных реферальных ссылок
- Новые ссылки за период
- Отозванные ссылки

---

### 4. **ref_clicks** (431 запись) - Клики по реферальным ссылкам
**Назначение:** Отслеживание кликов по реферальным ссылкам

**Ключевые поля:**
- `id` (UUID)
- `refCode` - реферальный код
- `customerId` - ID клиента (если определен)
- `firstSeenAt` - первое время клика
- `ipHash` - хеш IP адреса
- `userAgent` - user agent браузера
- `landingUrl` - URL страницы входа
- `utmSource`, `utmMedium`, `utmCampaign` - UTM параметры
- `matched` - совпал ли клик с бронированием
- `createdAt` - дата создания

**Связи:**
- `Customer` (N:1, опционально)

**Для дашборда:**
- Общее количество кликов
- Клики по дням/неделям/месяцам
- Конверсия кликов в совпадения (matched)
- Топ реферальные коды по кликам
- UTM аналитика

---

### 5. **ref_matches** (4 записи) - Совпадения рефералов
**Назначение:** Связывает клики с реальными бронированиями

**Ключевые поля:**
- `id` (UUID)
- `bookingId` - ID бронирования в Square
- `customerId` - ID клиента
- `refCode` - реферальный код
- `refClickId` - ID клика (если связан)
- `matchedVia` - метод совпадения (EMAIL, PHONE, IP_UA, MANUAL)
- `confidence` - уверенность совпадения (0.0-1.0)
- `matchedAt`, `createdAt` - даты

**Связи:**
- `Customer` (N:1)

**Для дашборда:**
- Количество совпадений
- Конверсия кликов в совпадения
- Методы совпадения (какой метод чаще работает)
- Средняя уверенность совпадений

---

### 6. **ref_rewards** (2 записи) - Награды за рефералов
**Назначение:** Награды для рефереров и друзей

**Ключевые поля:**
- `id` (UUID)
- `type` - тип награды (FRIEND_DISCOUNT, REFERRER_REWARD)
- `referrerCustomerId` - ID реферера
- `friendCustomerId` - ID друга
- `bookingId` - ID бронирования
- `refMatchId` - ID совпадения
- `amount` - сумма награды
- `currency` - валюта (по умолчанию USD)
- `status` - статус (PENDING, GRANTED, REDEEMED, VOID)
- `reason` - причина награды
- `createdAt`, `grantedAt`, `redeemedAt` - даты

**Связи:**
- `Customer` (N:1) - как реферер
- `Customer` (N:1) - как друг

**Для дашборда:**
- Общая сумма наград
- Награды по статусам
- Награды по типам
- Средняя сумма награды
- Конверсия совпадений в награды

---

### 7. **giftcard_jobs** (4,921 записей) - Очередь задач подарочных карт
**Назначение:** Асинхронная обработка webhook'ов подарочных карт

**Ключевые поля:**
- `id` (UUID)
- `correlation_id` - ID корреляции
- `trigger_type` - тип триггера
- `stage` - этап обработки
- `status` - статус (queued, running, completed, error)
- `payload` - JSON данные задачи
- `context` - JSON контекст
- `attempts` - количество попыток
- `max_attempts` - максимум попыток
- `scheduled_at`, `locked_at` - даты
- `last_error` - последняя ошибка
- `created_at`, `updated_at` - даты

**Для дашборда:**
- Статистика по статусам задач
- Застрявшие задачи (stuck jobs)
- Среднее время выполнения
- Процент ошибок
- Очередь задач

---

### 8. **giftcard_runs** (4,919 записей) - Отслеживание выполнения
**Назначение:** Логирование всех этапов обработки подарочных карт

**Ключевые поля:**
- `id` (UUID)
- `correlation_id` - ID корреляции
- `square_event_id` - ID события Square
- `square_event_type` - тип события Square
- `trigger_type` - тип триггера
- `resource_id` - ID ресурса
- `stage` - этап обработки
- `status` - статус (pending, completed, error)
- `attempts` - количество попыток
- `last_error` - последняя ошибка
- `payload`, `context` - JSON данные
- `resumed_at`, `created_at`, `updated_at` - даты

**Для дашборда:**
- Статистика по статусам
- Время обработки
- Процент успешных обработок
- Типы событий Square

---

### 9. **notification_events** (80 записей) - События уведомлений
**Назначение:** Отслеживание отправки уведомлений (SMS/Email)

**Ключевые поля:**
- `id` (UUID)
- `channel` - канал (SMS, EMAIL)
- `templateType` - тип шаблона (REFERRAL_INVITE, REFERRER_ACTIVATION, FRIEND_ACTIVATION, OTHER)
- `status` - статус (queued, sent, delivered, failed, bounced)
- `customerId` - ID клиента
- `referrerCustomerId` - ID реферера
- `referralEventId` - ID события реферала
- `externalId` - внешний ID (например, SendGrid message ID)
- `templateId` - ID шаблона
- `sentAt`, `statusAt` - даты
- `errorCode`, `errorMessage` - ошибки
- `metadata` - JSON метаданные
- `createdAt` - дата создания

**Для дашборда:**
- Статистика по каналам (SMS vs Email)
- Статистика по статусам
- Процент доставки
- Процент ошибок
- Статистика по типам шаблонов

---

### 10. **processed_events** (180 записей) - Обработанные события
**Назначение:** Идемпотентность обработки событий

**Ключевые поля:**
- `idempotencyKey` - ключ идемпотентности
- `createdAt` - дата обработки

**Для дашборда:**
- Количество обработанных событий
- События за период

---

## 🔗 Связи между таблицами

```
customers
  ├── ref_links (1:1)
  ├── ref_clicks (1:N)
  ├── ref_matches (1:N)
  └── ref_rewards (1:N) [как referrer и как friend]

ref_matches
  └── ref_rewards (1:N)

square_existing_clients (legacy, не связана с новой системой)
```

---

## 📈 Рекомендации для дашборда Lovable

### 1. **Основные метрики для отображения**

#### Реферальная программа:
- Общее количество клиентов (`customers` + `square_existing_clients`)
- Активные рефереры (с `ref_links` и статусом ACTIVE)
- Общее количество кликов (`ref_clicks`)
- Конверсия кликов в совпадения (`ref_matches` / `ref_clicks`)
- Общая сумма наград (`ref_rewards`)
- Награды по статусам (PENDING, GRANTED, REDEEMED)

#### Подарочные карты:
- Статистика задач (`giftcard_jobs` по статусам)
- Застрявшие задачи (stuck jobs)
- Статистика выполнения (`giftcard_runs`)
- Процент успешных обработок

#### Уведомления:
- Статистика по каналам (SMS vs Email)
- Процент доставки
- Процент ошибок
- Статистика по типам шаблонов

### 2. **Временные графики**

- Клики по дням/неделям/месяцам
- Совпадения по времени
- Награды по времени
- Новые клиенты по времени
- Задачи по времени

### 3. **Проблемы, которые нужно решить**

#### Дублирование данных клиентов:
- `customers` (23 записи) - новая система
- `square_existing_clients` (7,265 записей) - legacy система
- **Рекомендация:** Создать view или объединенный запрос для дашборда

#### Недостающие связи:
- `square_existing_clients` не связана с новой системой через foreign keys
- Нужно использовать `square_customer_id` для связи

### 4. **Улучшения базы данных для дашборда**

#### A. Создать индексы для быстрых запросов:

```sql
-- Для временных запросов
CREATE INDEX IF NOT EXISTS idx_customers_created_at ON customers(created_at);
CREATE INDEX IF NOT EXISTS idx_ref_clicks_created_at ON ref_clicks(created_at);
CREATE INDEX IF NOT EXISTS idx_ref_matches_matched_at ON ref_matches(matched_at);
CREATE INDEX IF NOT EXISTS idx_ref_rewards_created_at ON ref_rewards(created_at);

-- Для фильтрации по статусам
CREATE INDEX IF NOT EXISTS idx_ref_links_status ON ref_links(status);
CREATE INDEX IF NOT EXISTS idx_ref_rewards_status ON ref_rewards(status);
CREATE INDEX IF NOT EXISTS idx_giftcard_jobs_status ON giftcard_jobs(status);
CREATE INDEX IF NOT EXISTS idx_notification_events_status ON notification_events(status);

-- Для связи между таблицами
CREATE INDEX IF NOT EXISTS idx_ref_clicks_ref_code ON ref_clicks(ref_code);
CREATE INDEX IF NOT EXISTS idx_ref_matches_ref_code ON ref_matches(ref_code);
```

#### B. Создать материализованные view для агрегации:

```sql
-- Статистика реферальной программы
CREATE MATERIALIZED VIEW referral_stats AS
SELECT 
  DATE_TRUNC('day', rc.created_at) as date,
  COUNT(DISTINCT rc.id) as total_clicks,
  COUNT(DISTINCT CASE WHEN rc.matched THEN rc.id END) as matched_clicks,
  COUNT(DISTINCT rm.id) as total_matches,
  COUNT(DISTINCT rr.id) as total_rewards,
  SUM(CASE WHEN rr.status = 'GRANTED' THEN rr.amount ELSE 0 END) as total_reward_amount
FROM ref_clicks rc
LEFT JOIN ref_matches rm ON rm.ref_code = rc.ref_code
LEFT JOIN ref_rewards rr ON rr.ref_match_id = rm.id
GROUP BY DATE_TRUNC('day', rc.created_at);

-- Статистика клиентов
CREATE MATERIALIZED VIEW customer_stats AS
SELECT 
  DATE_TRUNC('day', c.created_at) as date,
  COUNT(DISTINCT c.id) as new_customers,
  COUNT(DISTINCT CASE WHEN c.first_paid_seen THEN c.id END) as first_paid_customers,
  COUNT(DISTINCT rl.id) as new_referrers
FROM customers c
LEFT JOIN ref_links rl ON rl.customer_id = c.id AND rl.status = 'ACTIVE'
GROUP BY DATE_TRUNC('day', c.created_at);
```

#### C. Добавить поля для аналитики:

```prisma
// В модель Customer добавить:
model Customer {
  // ... существующие поля
  lastActivityAt DateTime?  // последняя активность
  totalClicks    Int         @default(0)  // общее количество кликов
  totalMatches   Int         @default(0)  // общее количество совпадений
  totalRewards   Int         @default(0)  // общее количество наград
}
```

#### D. Создать таблицу для агрегированной статистики:

```prisma
model ReferralDailyStats {
  id            String   @id @default(uuid())
  date          DateTime @unique @db.Date
  totalClicks   Int      @default(0)
  totalMatches  Int      @default(0)
  totalRewards  Int      @default(0)
  rewardAmount  Int      @default(0)
  newCustomers  Int      @default(0)
  newReferrers  Int      @default(0)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@map("referral_daily_stats")
}
```

### 5. **SQL запросы для дашборда**

#### Общая статистика реферальной программы:
```sql
SELECT 
  (SELECT COUNT(*) FROM customers) as total_customers,
  (SELECT COUNT(*) FROM ref_links WHERE status = 'ACTIVE') as active_referrers,
  (SELECT COUNT(*) FROM ref_clicks) as total_clicks,
  (SELECT COUNT(*) FROM ref_matches) as total_matches,
  (SELECT COUNT(*) FROM ref_rewards WHERE status = 'GRANTED') as granted_rewards,
  (SELECT SUM(amount) FROM ref_rewards WHERE status = 'GRANTED') as total_reward_amount;
```

#### Клики по дням:
```sql
SELECT 
  DATE(created_at) as date,
  COUNT(*) as clicks,
  COUNT(CASE WHEN matched THEN 1 END) as matched_clicks
FROM ref_clicks
GROUP BY DATE(created_at)
ORDER BY date DESC
LIMIT 30;
```

#### Топ реферальные коды:
```sql
SELECT 
  rc.ref_code,
  COUNT(DISTINCT rc.id) as clicks,
  COUNT(DISTINCT rm.id) as matches,
  COUNT(DISTINCT rr.id) as rewards
FROM ref_clicks rc
LEFT JOIN ref_matches rm ON rm.ref_code = rc.ref_code
LEFT JOIN ref_rewards rr ON rr.ref_match_id = rm.id
GROUP BY rc.ref_code
ORDER BY clicks DESC
LIMIT 10;
```

---

## 🔧 Настройка подключения к Lovable

### 1. **Получить DATABASE_URL**
- Проверить переменные окружения в Vercel или локально
- Формат: `postgresql://user:password@host:port/database?sslmode=require`

### 2. **Настроить подключение в Lovable**
- Использовать PostgreSQL connector
- Вставить `DATABASE_URL`
- Lovable автоматически определит схему через Prisma или напрямую

### 3. **Рекомендуемые таблицы для подключения**
- `customers`
- `ref_links`
- `ref_clicks`
- `ref_matches`
- `ref_rewards`
- `giftcard_jobs`
- `giftcard_runs`
- `notification_events`
- `square_existing_clients` (для legacy данных)

### 4. **Создать объединенный view для клиентов**
```sql
CREATE VIEW unified_customers AS
SELECT 
  COALESCE(c.id, sec.square_customer_id) as id,
  COALESCE(c.email, sec.email_address) as email,
  COALESCE(c.phone_e164, sec.phone_number) as phone,
  COALESCE(c.full_name, CONCAT(sec.given_name, ' ', sec.family_name)) as full_name,
  COALESCE(c.created_at, sec.created_at) as created_at,
  COALESCE(c.first_paid_seen, sec.first_payment_completed, false) as first_paid,
  sec.total_referrals,
  sec.total_rewards,
  sec.activated_as_referrer
FROM customers c
FULL OUTER JOIN square_existing_clients sec ON c.square_customer_id = sec.square_customer_id;
```

---

## 📝 Следующие шаги

1. ✅ Изучить текущую структуру (выполнено)
2. ⏳ Создать индексы для оптимизации запросов
3. ⏳ Создать материализованные view для агрегации
4. ⏳ Настроить подключение к Lovable
5. ⏳ Создать объединенный view для клиентов
6. ⏳ Протестировать запросы в дашборде

---

**Дата создания:** 2025-01-27
**Автор:** AI Assistant

