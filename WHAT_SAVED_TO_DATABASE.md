# 💾 Какие данные сохраняются в базу данных при отправке email

## 📋 Что сохраняется при отправке Referral Code Email

### 1. Таблица `square_existing_clients`

**Обновляется поле:**
- `referral_email_sent` = `TRUE` ✅
- `updated_at` = текущее время ✅

**Код обновления:**
```sql
UPDATE square_existing_clients
SET referral_email_sent = TRUE,
    updated_at = NOW()
WHERE square_customer_id = [customer_id]
```

**Что это означает:**
- ✅ Отмечает, что email был отправлен клиенту
- ✅ Обновляет время последнего изменения записи
- ✅ Предотвращает повторную отправку email

### 2. Таблица `notification_events` (если используется analytics)

**Создается запись с данными:**
- `channel` = `EMAIL`
- `templateType` = `REFERRAL_INVITE`
- `status` = `sent` (если успешно) или `failed` (если ошибка)
- `customerId` = ID клиента
- `externalId` = Message ID от SendGrid (например: `qFoaid64R3O3EhuS7A4heg`)
- `templateId` = ID шаблона SendGrid (если используется)
- `metadata` = JSON с данными:
  - `email` - email адрес
  - `referralCode` - referral code
  - `referralUrl` - referral URL
  - `suppressionGroupId` - ID suppression group
  - `sendgridStatusCode` - статус код от SendGrid
  - `sendgridResponse` - полный ответ от SendGrid
- `sentAt` = время отправки (если успешно)
- `errorMessage` = сообщение об ошибке (если ошибка)
- `errorCode` = код ошибки (если ошибка)
- `createdAt` = время создания записи

**Примечание:** В текущей версии кода `trackEmailNotification` не вызывается напрямую в `sendReferralCodeEmail`, но может вызываться в других местах системы.

## 📊 Полный список данных, которые могут быть сохранены

### В `square_existing_clients`:
- ✅ `referral_email_sent` = `TRUE` (обновляется скриптом)
- ✅ `updated_at` = текущее время (обновляется скриптом)
- ✅ `personal_code` = referral code (уже есть)
- ✅ `referral_url` = referral URL (уже есть)
- ✅ `email_address` = email адрес (уже есть)

### В `notification_events` (если используется):
- ✅ `channel` = `EMAIL`
- ✅ `templateType` = `REFERRAL_INVITE`
- ✅ `status` = `sent` или `failed`
- ✅ `customerId` = ID клиента
- ✅ `externalId` = Message ID от SendGrid
- ✅ `metadata` = JSON с деталями отправки
- ✅ `sentAt` = время отправки
- ✅ `createdAt` = время создания записи

## 🔍 Как проверить, что данные сохранены

### Проверка в `square_existing_clients`:

```sql
SELECT 
  square_customer_id,
  given_name,
  family_name,
  email_address,
  personal_code,
  referral_email_sent,
  updated_at
FROM square_existing_clients
WHERE referral_email_sent = TRUE
  AND updated_at >= '2025-12-29'
ORDER BY updated_at DESC
LIMIT 20;
```

### Проверка в `notification_events`:

```sql
SELECT 
  id,
  channel,
  template_type,
  status,
  customer_id,
  external_id,
  sent_at,
  error_message,
  metadata,
  created_at
FROM notification_events
WHERE channel = 'EMAIL'
  AND created_at >= '2025-12-29'
ORDER BY created_at DESC
LIMIT 20;
```

## ⚠️ Важно

1. **Скрипт `retry-failed-emails.js` обновляет только:**
   - `referral_email_sent = TRUE`
   - `updated_at = NOW()`

2. **Данные в `notification_events` сохраняются автоматически** функцией `sendReferralCodeEmail`, если она вызывает `trackEmailNotification` (но в текущей версии кода это может быть отключено).

3. **Все данные о клиенте уже есть в базе:**
   - `personal_code` (referral code)
   - `referral_url` (referral URL)
   - `email_address` (email адрес)
   - `given_name`, `family_name` (имя клиента)

## ✅ Итого

**При отправке email через скрипт `retry-failed-emails.js`:**

1. ✅ Обновляется `square_existing_clients.referral_email_sent = TRUE`
2. ✅ Обновляется `square_existing_clients.updated_at = NOW()`
3. ⚠️ Запись в `notification_events` может создаваться автоматически (зависит от версии кода)

**Все остальные данные клиента уже есть в базе данных** и не изменяются при отправке email.

