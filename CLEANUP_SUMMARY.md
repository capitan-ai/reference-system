# Резюме очистки неиспользуемых таблиц

**Дата:** 2025-01-27

## Удаленные таблицы

Следующие таблицы были удалены из базы данных, так как они не использовались или никогда не заполнялись:

1. **idempotency** - заменена на `processed_events`
2. **gift_card_cache** - никогда не заполнялась, код только читал (всегда null)
3. **referral_process_runs** - никогда не заполнялась, нет кода для создания записей
4. **referral_events** - никогда не заполнялась, нет кода для создания записей
5. **referrer_stats** - никогда не заполнялась, статистика хранится в `square_existing_clients`
6. **revenue_attribution** - никогда не заполнялась, нет кода для создания записей
7. **analytics_events** - никогда не заполнялась, нет кода для создания записей

## Выполненные изменения

### 1. Schema (prisma/schema.prisma)
- Удалены модели: `Idempotency`, `GiftCardCache`, `ReferralProcessRun`, `ReferralEvent`, `ReferrerStat`, `RevenueAttribution`, `AnalyticsEvent`
- Удалены все связи с этими таблицами
- Удалены неиспользуемые enum'ы: `GiftCardRole`, `ReferralEventType`, `ProcessRunStatus`

### 2. Код
- **lib/wallet/giftcard-context.js** - удалена проверка `giftCardCache`, теперь всегда запрашивает данные из Square API
- **lib/wallet/giftcard-number-utils.js** - удалена проверка `giftCardCache`, теперь использует только `square_existing_clients`
- **app/api/wallet/v1/passes/[passTypeIdentifier]/[serialNumber]/route.js** - удалена проверка `giftCardCache`
- **scripts/check-new-customers.js** - закомментирована проверка `referral_events` (таблица удалена)
- **scripts/check-webhook-customers.js** - закомментирована проверка `analytics_events` (таблица удалена)

### 3. Миграция
- Создана миграция: `prisma/migrations/20251229031256_remove_unused_tables/migration.sql`
- Миграция удаляет все неиспользуемые таблицы из базы данных

### 4. Скрипты
- Обновлен `scripts/analyze-database-tables.js` - удалены ссылки на удаленные таблицы

## Применение миграции

Для применения миграции выполните:

```bash
npx prisma migrate deploy
```

Или для разработки:

```bash
npx prisma db push
```

## Важные замечания

- **device_pass_registrations** - оставлена, так как активно используется для Apple Wallet
- **notification_events** - оставлена, так как активно используется (80 записей)
- Все связи с удаленными таблицами были удалены из схемы
- Код, который использовал удаленные таблицы, был обновлен или закомментирован

## Результат

База данных теперь содержит только используемые таблицы:
- 13 активных таблиц (было 20)
- Удалено 7 неиспользуемых таблиц
- Код очищен от мертвых ссылок на несуществующие таблицы





