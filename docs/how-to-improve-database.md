# Как улучшить базу данных для дашборда

## 🚀 Быстрый старт

### Шаг 1: Применить SQL скрипт

Выполните SQL скрипт для создания индексов и view:

```bash
# Вариант 1: Через psql
psql $DATABASE_URL -f scripts/improve-database-for-dashboard.sql

# Вариант 2: Через Prisma Studio (если поддерживает SQL)
# Или через любой PostgreSQL клиент
```

### Шаг 2: Проверить созданные объекты

```sql
-- Проверить индексы
SELECT indexname, tablename 
FROM pg_indexes 
WHERE indexname LIKE 'idx_%'
ORDER BY tablename;

-- Проверить view
SELECT table_name 
FROM information_schema.views 
WHERE table_schema = 'public';

-- Проверить материализованные view
SELECT matviewname 
FROM pg_matviews;
```

### Шаг 3: Обновить материализованные view

```sql
-- Обновить все view сразу
SELECT refresh_all_dashboard_views();

-- Или обновить по отдельности
REFRESH MATERIALIZED VIEW CONCURRENTLY referral_daily_stats;
REFRESH MATERIALIZED VIEW CONCURRENTLY customer_daily_stats;
REFRESH MATERIALIZED VIEW CONCURRENTLY giftcard_daily_stats;
REFRESH MATERIALIZED VIEW CONCURRENTLY notification_daily_stats;
```

## 📊 Что было создано

### Индексы (для быстрых запросов)
- Временные индексы на `created_at`, `matched_at`, `granted_at`
- Индексы по статусам для фильтрации
- Индексы для связей между таблицами

### View (для удобных запросов)
- `unified_customers` - объединенные данные клиентов (новая + legacy система)
- `referral_link_stats` - статистика по реферальным ссылкам
- `referral_overview_stats` - общая статистика реферальной программы
- `top_referral_codes` - топ реферальных кодов

### Материализованные view (для агрегации)
- `referral_daily_stats` - статистика рефералов по дням
- `customer_daily_stats` - статистика клиентов по дням
- `giftcard_daily_stats` - статистика задач по дням
- `notification_daily_stats` - статистика уведомлений по дням

## 🔄 Автоматическое обновление

### Вариант 1: Через cron (если есть доступ к серверу)

```bash
# Добавить в crontab (обновлять каждый час)
0 * * * * psql $DATABASE_URL -c "SELECT refresh_all_dashboard_views();"
```

### Вариант 2: Через Vercel Cron Jobs

Создать API endpoint для обновления:

```javascript
// app/api/cron/refresh-dashboard-stats/route.js
export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    await prisma.$executeRaw`SELECT refresh_all_dashboard_views()`;
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
```

И добавить в `vercel.json`:

```json
{
  "crons": [{
    "path": "/api/cron/refresh-dashboard-stats",
    "schedule": "0 * * * *"
  }]
}
```

### Вариант 3: Вручную при необходимости

Просто выполнить SQL запрос когда нужно обновить данные.

## 📈 Использование в Lovable

### Подключение таблиц

В Lovable подключите следующие таблицы:
- `customers`
- `ref_links`
- `ref_clicks`
- `ref_matches`
- `ref_rewards`
- `giftcard_jobs`
- `giftcard_runs`
- `notification_events`
- `square_existing_clients`

### Использование view

Также подключите созданные view:
- `unified_customers` - для работы с клиентами
- `referral_daily_stats` - для временных графиков
- `referral_overview_stats` - для общей статистики
- `top_referral_codes` - для топ реферальных кодов

### Примеры запросов

#### Общая статистика
```sql
SELECT * FROM referral_overview_stats;
```

#### Клики по дням (последние 30 дней)
```sql
SELECT * FROM referral_daily_stats 
WHERE date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY date DESC;
```

#### Топ реферальные коды
```sql
SELECT * FROM top_referral_codes LIMIT 10;
```

#### Новые клиенты по дням
```sql
SELECT * FROM customer_daily_stats 
WHERE date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY date DESC;
```

## ⚠️ Важные замечания

1. **Материализованные view нужно обновлять периодически**
   - Они не обновляются автоматически
   - Рекомендуется обновлять каждый час или раз в день

2. **CONCURRENTLY обновление**
   - Используется `CONCURRENTLY` для обновления без блокировки таблиц
   - Требует уникальный индекс на материализованном view

3. **Производительность**
   - Индексы улучшат скорость запросов
   - Материализованные view ускорят агрегацию
   - Но они занимают место в базе данных

4. **Дублирование данных**
   - `unified_customers` объединяет `customers` и `square_existing_clients`
   - Это временное решение до полной миграции

## 🔍 Проверка работы

### Проверить индексы
```sql
EXPLAIN ANALYZE 
SELECT * FROM ref_clicks 
WHERE created_at >= CURRENT_DATE - INTERVAL '7 days';
```

### Проверить view
```sql
SELECT COUNT(*) FROM unified_customers;
SELECT * FROM referral_overview_stats;
```

### Проверить материализованные view
```sql
SELECT * FROM referral_daily_stats 
ORDER BY date DESC 
LIMIT 7;
```

## 📝 Следующие шаги

1. ✅ Применить SQL скрипт
2. ✅ Проверить созданные объекты
3. ✅ Настроить автоматическое обновление (опционально)
4. ✅ Подключить к Lovable
5. ✅ Протестировать запросы в дашборде

---

**Файлы:**
- SQL скрипт: `scripts/improve-database-for-dashboard.sql`
- Подробная документация: `docs/database-for-dashboard.md`
- Краткая сводка: `docs/database-summary-ru.md`





