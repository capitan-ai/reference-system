# Анализ всех скриптов в проекте

**Дата анализа:** 2025-01-XX  
**Всего скриптов:** 58

---

## 📊 Категории скриптов

### ✅ **ПОЛЕЗНЫЕ - Оставить** (Production-ready утилиты)

#### 🔍 **Check/Monitoring скрипты** (15 файлов)
Эти скрипты используются для мониторинга и диагностики системы:

1. **`check-queued-jobs.js`** ⭐⭐⭐
   - Проверяет статус очереди gift card jobs
   - Показывает jobs по статусам, stuck jobs, cron status
   - **Статус:** Очень полезен для production

2. **`check-job-status.js`** ⭐⭐⭐
   - Проверяет почему jobs застряли в queued
   - Анализирует giftcard_jobs таблицу
   - **Статус:** Полезен для диагностики

3. **`check-new-customers.js`** ⭐⭐
   - Проверяет новых клиентов за последние 15 дней
   - Использует referral_events (аналитика удалена, но таблица может быть)
   - **Статус:** Полезен, но нужно обновить (убрать аналитику)

4. **`check-email-sendgrid-status.js`** ⭐⭐⭐
   - Проверяет статус SendGrid API
   - Проверяет recent email activity
   - **Статус:** Очень полезен для production

5. **`check-email-status.js`** ⭐⭐
   - Проверяет почему emails не отправляются
   - Анализирует notification events
   - **Статус:** Полезен, но дублирует функциональность

6. **`check-gift-card-email-recipients.js`** ⭐
   - Проверяет почему конкретные клиенты получили gift card emails
   - Хардкод email адресов в скрипте
   - **Статус:** Одноразовый, можно удалить

7. **`check-referral-code-usage.js`** ⭐⭐⭐
   - Проверяет использование referral кодов
   - Анализирует RefMatch, RefClick, RefReward
   - **Статус:** Очень полезен

8. **`check-referral-code.js`** ⭐⭐
   - Ищет конкретный referral code в базе
   - **Статус:** Полезен для быстрого поиска

9. **`check-referral-urls-in-db.js`** ⭐⭐
   - Проверяет referral URLs в базе данных
   - **Статус:** Полезен

10. **`check-sendgrid-config.js`** ⭐⭐
    - Проверяет конфигурацию SendGrid
    - **Статус:** Полезен

11. **`check-square-existing-clients-urls.js`** ⭐⭐
    - Проверяет URLs в square_existing_clients
    - **Статус:** Полезен

12. **`check-token-status.js`** ⭐⭐
    - Проверяет статус Square access token
    - **Статус:** Полезен

13. **`check-vercel-domains.js`** ⭐
    - Проверяет конфигурацию Vercel доменов
    - **Статус:** Одноразовый, можно удалить

14. **`check-vercel-email-errors.js`** ⭐
    - Анализирует возможные ошибки email в Vercel
    - **Статус:** Одноразовый troubleshooting

15. **`check-vercel-env-vars.js`** ⭐
    - Проверяет env переменные через API
    - **Статус:** Одноразовый

16. **`check-webhook-customers.js`** ⭐⭐
    - Проверяет webhook логи для customer.created
    - **Статус:** Полезен

17. **`check-webhook-status.js`** ⭐
    - Простой статус webhook endpoint
    - Хардкод URL
    - **Статус:** Одноразовый, можно удалить

18. **`check-all-customers-referral-urls.js`** ⭐⭐
    - Проверяет все referral URLs клиентов
    - **Статус:** Полезен

19. **`check-all-recent-activity.js`** ⭐⭐
    - Проверяет любую недавнюю активность в базе
    - **Статус:** Полезен для мониторинга

#### 🔧 **Worker/Processing скрипты** (2 файла)

1. **`giftcard-worker.js`** ⭐⭐⭐⭐⭐
   - **КРИТИЧЕСКИЙ** - основной worker для обработки gift card jobs
   - Используется cron job'ом
   - **Статус:** НЕ УДАЛЯТЬ! Production-critical

2. **`unlock-stuck-jobs.js`** ⭐⭐⭐
   - Разблокирует застрявшие jobs
   - **Статус:** Очень полезен для production

#### 📧 **Email/SMS скрипты** (5 файлов)

1. **`retry-failed-emails.js`** ⭐⭐⭐
   - Повторная отправка failed emails
   - Использует notification_events (аналитика удалена)
   - **Статус:** Полезен, но нужно обновить (убрать зависимость от аналитики)

2. **`send-referral-emails-to-all-customers.js`** ⭐⭐⭐
   - Отправка referral emails всем клиентам из square_existing_clients
   - Batch processing, rate limiting
   - **Статус:** Полезен для массовой рассылки

3. **`send-referral-emails-to-customers.js`** ⭐⭐
   - Отправка emails клиентам из Customer/RefLink моделей
   - **Статус:** Полезен

4. **`send-referral-urls-to-all-customers.js`** ⭐⭐
   - Отправка referral URLs всем клиентам
   - **Статус:** Полезен

5. **`send-referral-sms-no-email.js`** ⭐⭐⭐
   - Отправка SMS клиентам без email
   - Batch processing, rate limiting
   - **Статус:** Очень полезен

#### 🔄 **Backfill/Data Migration скрипты** (4 файла)

1. **`backfill-gift-card-gans.js`** ⭐⭐⭐
   - Заполняет gift_card_gan из Square API или audit таблицы
   - **Статус:** Полезен для миграции данных

2. **`backfill-missing-customer-names.js`** ⭐⭐
   - Заполняет missing имена клиентов из Square
   - **Статус:** Полезен

3. **`audit-gift-card-gans.js`** ⭐⭐⭐
   - Аудит gift card GANs - создает audit таблицу
   - **Статус:** Полезен для мониторинга

4. **`activate-existing-referrers.js`** ⭐⭐
   - Активирует существующих referrers
   - **Статус:** Одноразовый, но может понадобиться

#### 🔍 **Get/Find скрипты** (6 файлов)

1. **`get-customer-gift-card.js`** ⭐⭐⭐
   - Получает gift card данные для клиента
   - **Статус:** Очень полезен

2. **`get-gift-card-activity.js`** ⭐⭐⭐
   - Получает activity history для gift card
   - **Статус:** Очень полезен

3. **`get-gift-card-details.js`** ⭐⭐
   - Получает детали gift card
   - **Статус:** Полезен

4. **`get-vercel-email-logs.js`** ⭐
   - Получает логи Vercel через CLI
   - **Статус:** Одноразовый, можно удалить

5. **`get-webhook-logs.js`** ⭐
   - Получает webhook логи через Vercel CLI
   - **Статус:** Одноразовый, можно удалить

6. **`find-all-self-referrals.js`** ⭐⭐⭐
   - Находит self-referral abuse cases
   - **Статус:** Очень полезен для безопасности

7. **`find-payments-by-customer.js`** ⭐⭐⭐
   - Находит payments для клиента
   - **Статус:** Очень полезен

#### 🔄 **Update/Sync скрипты** (6 файлов)

1. **`update-all-referral-codes.js`** ⭐⭐
   - Обновляет все referral codes
   - **Статус:** Одноразовый, но может понадобиться

2. **`update-referral-urls-to-custom-domain.js`** ⭐
   - Обновляет URLs на custom domain
   - **Статус:** Одноразовый, уже выполнено

3. **`update-urls-to-custom-domain-direct.js`** ⭐
   - Прямое обновление URLs
   - **Статус:** Одноразовый, дублирует предыдущий

4. **`update-urls-to-custom-domain-square-existing-clients.js`** ⭐
   - Обновление URLs в square_existing_clients
   - **Статус:** Одноразовый, дублирует предыдущий

5. **`ensure-urls-in-square-existing-clients.js`** ⭐⭐
   - Обеспечивает наличие URLs в таблице
   - **Статус:** Полезен

6. **`sync-urls-to-square-existing-clients.js`** ⭐⭐
   - Синхронизирует URLs из ref_links
   - **Статус:** Полезен

#### 🎁 **Gift Card скрипты** (2 файла)

1. **`activate-customer-gift-card.js`** ⭐⭐⭐
   - Активирует gift card для клиента
   - **Статус:** Очень полезен

#### 🔗 **Generate скрипты** (3 файла)

1. **`generate-referral-codes-simple.js`** ⭐⭐
   - Генерирует referral codes
   - **Статус:** Полезен

2. **`generate-referral-codes-square-existing-clients.js`** ⭐⭐
   - Генерирует codes для square_existing_clients
   - **Статус:** Полезен

3. **`generate-referral-links-for-all-customers.js`** ⭐⭐
   - Генерирует referral links для всех клиентов
   - **Статус:** Полезен

#### ✅ **Verify скрипты** (3 файла)

1. **`verify-all-customers-email-readiness.js`** ⭐⭐⭐
   - Проверяет готовность к отправке emails всем клиентам
   - **Статус:** Очень полезен перед массовой рассылкой

2. **`verify-email-readiness.js`** ⭐⭐
   - Проверяет готовность email сервиса
   - **Статус:** Полезен

3. **`verify-apple-certificates.js`** ⭐⭐⭐
   - Проверяет Apple Wallet сертификаты
   - **Статус:** Очень полезен

#### 🔄 **Replay/Compare скрипты** (3 файла)

1. **`replay-square-events.js`** ⭐⭐⭐
   - Replay Square events для backfilling
   - **Статус:** Очень полезен для восстановления данных

2. **`compare-square-with-db.js`** ⭐⭐⭐
   - Сравнивает Square customers с базой
   - **Статус:** Очень полезен для синхронизации

3. **`fetch-and-compare-square-customers.js`** ⭐⭐
   - Fetch и сравнение клиентов
   - **Статус:** Дублирует предыдущий, можно удалить

#### 📊 **Report скрипты** (1 файл)

1. **`report-referral-email-delivery-status.js`** ⭐⭐⭐
   - Отчет о статусе доставки emails
   - Сравнивает Postgres с SendGrid
   - **Статус:** Очень полезен

#### 🎨 **Apple Wallet скрипты** (2 файла)

1. **`create-pass-images.js`** ⭐⭐
   - Создает изображения для Apple Wallet pass
   - **Статус:** Полезен для setup

2. **`encode-certificates-for-vercel.js`** ⭐⭐
   - Кодирует сертификаты для Vercel
   - **Статус:** Полезен для setup

---

## ⚠️ **СКРИПТЫ С ПРОБЛЕМАМИ** (нужно обновить)

1. **`retry-failed-emails.js`**
   - Использует `notification_events` таблицу (аналитика удалена)
   - **Действие:** Обновить или удалить

2. **`check-new-customers.js`**
   - Использует `referral_events` таблицу (аналитика удалена)
   - **Действие:** Обновить, убрать зависимость от аналитики

---

## 🗑️ **ОДНОРАЗОВЫЕ - Можно удалить** (10+ файлов)

1. **`check-gift-card-email-recipients.js`** - хардкод email адресов
2. **`check-vercel-domains.js`** - одноразовая проверка
3. **`check-vercel-email-errors.js`** - одноразовый troubleshooting
4. **`check-vercel-env-vars.js`** - одноразовая проверка
5. **`check-webhook-status.js`** - хардкод URL, одноразовый
6. **`get-vercel-email-logs.js`** - одноразовый, использует CLI
7. **`get-webhook-logs.js`** - одноразовый, использует CLI
8. **`update-referral-urls-to-custom-domain.js`** - уже выполнено
9. **`update-urls-to-custom-domain-direct.js`** - дублирует предыдущий
10. **`update-urls-to-custom-domain-square-existing-clients.js`** - дублирует
11. **`fetch-and-compare-square-customers.js`** - дублирует compare-square-with-db.js

---

## 📋 **РЕКОМЕНДАЦИИ**

### ✅ **Оставить** (45+ скриптов)
- Все check/monitoring скрипты (кроме одноразовых)
- Все worker/processing скрипты
- Все email/SMS скрипты
- Все backfill/audit скрипты
- Все get/find скрипты
- Все generate/verify скрипты
- Все replay/compare скрипты (кроме дубликатов)

### ⚠️ **Обновить** (2 скрипта)
- `retry-failed-emails.js` - убрать зависимость от аналитики
- `check-new-customers.js` - убрать зависимость от аналитики

### 🗑️ **Удалить** (11 скриптов)
- Одноразовые check скрипты (5 файлов)
- Одноразовые get скрипты (2 файла)
- Одноразовые update скрипты (3 файла)
- Дубликат compare скрипт (1 файл)

---

## 📊 **Статистика**

- **Всего скриптов:** 58
- **Полезных (оставить):** ~45
- **Нужно обновить:** 2
- **Можно удалить:** 11

---

## 🎯 **Приоритеты**

### 🔴 **Критические** (не удалять!)
- `giftcard-worker.js` - основной worker

### 🟡 **Важные** (очень полезны)
- Все check/monitoring скрипты
- `unlock-stuck-jobs.js`
- `retry-failed-emails.js` (после обновления)
- `replay-square-events.js`
- `compare-square-with-db.js`
- `report-referral-email-delivery-status.js`

### 🟢 **Полезные** (можно использовать)
- Все остальные скрипты из категории "Оставить"

