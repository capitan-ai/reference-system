# 📧 Когда отправляется email с $10 Gift Card

## 🎯 Общая логика

Email с $10 Gift Card отправляется в **3 сценариях**:

---

## 1️⃣ Friend получает $10 Gift Card (при booking.created)

### Когда:
**Сразу после того, как новый клиент забронировал с referral кодом**

### Триггер:
- Webhook: `booking.created`
- Условие: Клиент использовал referral код при бронировании
- Условие: Это первое бронирование клиента (`got_signup_bonus = FALSE`)

### Что происходит:
1. ✅ Система находит referral код в booking данных или custom attributes
2. ✅ Создает $10 gift card для friend
3. ✅ Сохраняет gift card в базу данных
4. ✅ **Отправляет email с gift card** (строка 2784 в `route.js`)

### Код:
```javascript
// app/api/webhooks/square/referrals/route.js, строка 2784
if (friendEmail) {
  await sendGiftCardEmailNotification({
    customerName: friendNameBase || friendEmail || 'there',
    email: friendEmail,
    giftCardGan: friendGiftCard.giftCardGan,
    amountCents: friendGiftCard.amountCents, // $10
    balanceCents: friendGiftCard.balanceCents,
    activationUrl: friendGiftCard.activationUrl,
    passKitUrl: friendGiftCard.passKitUrl,
    giftCardId: friendGiftCard.giftCardId,
    waitForPassKit: true, // Ждет PassKit URL если нужно
    locationId: bookingLocationId
  })
}
```

### Email содержит:
- ✅ Gift Card GAN (номер карты)
- ✅ QR код для сканирования
- ✅ Ссылка на Apple Wallet (если доступна)
- ✅ Ссылка на digital gift card
- ✅ Инструкции по использованию

### Условия отправки:
- ✅ Email адрес должен быть указан (`customer.email_address` или `friendGiftCard.digitalEmail`)
- ✅ Gift card должен быть успешно создан
- ✅ Gift card GAN должен быть получен

---

## 2️⃣ Referrer получает НОВУЮ $10 Gift Card (при payment.updated)

### Когда:
**Когда friend платит в первый раз, и у referrer еще НЕТ gift card**

### Триггер:
- Webhook: `payment.updated`
- Условие: Friend использовал referral код (`customer.used_referral_code` не пусто)
- Условие: Это первый платеж friend (`first_payment_completed = FALSE`)
- Условие: У referrer НЕТ `gift_card_id` (первая награда)

### Что происходит:
1. ✅ Система находит referrer по referral коду
2. ✅ Создает НОВУЮ $10 gift card для referrer
3. ✅ Сохраняет gift card в базу данных
4. ✅ **Отправляет email с gift card** (строка 1893 в `route.js`)

### Код:
```javascript
// app/api/webhooks/square/referrals/route.js, строка 1893
if (referrerEmail) {
  await sendGiftCardEmailNotification({
    customerName: referrerNameBase || referrerEmail || 'there',
    email: referrerEmail,
    giftCardGan: referrerGiftCard.giftCardGan,
    amountCents: referrerGiftCard.amountCents, // $10
    balanceCents: referrerGiftCard.balanceCents,
    activationUrl: referrerGiftCard.activationUrl,
    passKitUrl: referrerGiftCard.passKitUrl,
    giftCardId: referrerGiftCard.giftCardId,
    waitForPassKit: true,
    locationId: paymentLocationId
  })
}
```

### Email содержит:
- ✅ Gift Card GAN (номер карты)
- ✅ QR код
- ✅ Ссылка на Apple Wallet
- ✅ Текущий баланс ($10)

---

## 3️⃣ Referrer получает $10 на СУЩЕСТВУЮЩУЮ Gift Card (при payment.updated)

### Когда:
**Когда friend платит, и у referrer УЖЕ ЕСТЬ gift card**

### Триггер:
- Webhook: `payment.updated`
- Условие: Friend использовал referral код
- Условие: Это первый платеж friend
- Условие: У referrer УЖЕ ЕСТЬ `gift_card_id` (не первая награда)

### Что происходит:
1. ✅ Система находит referrer по referral коду
2. ✅ Загружает $10 на СУЩЕСТВУЮЩУЮ gift card (используя `loadGiftCard()`)
3. ✅ Обновляет баланс в базе данных
4. ✅ **Отправляет email с обновленным балансом** (строка 1983 в `route.js`)

### Код:
```javascript
// app/api/webhooks/square/referrals/route.js, строка 1983
if (referrerEmail && loadResult.giftCardGan) {
  await sendGiftCardEmailNotification({
    customerName: referrerNameBase || referrerEmail || 'there',
    email: referrerEmail,
    giftCardGan: loadResult.giftCardGan,
    amountCents: rewardAmountCents, // $10 (добавлено)
    balanceCents: loadResult.balanceCents, // Новый баланс (например, $20, $30...)
    activationUrl: loadResult.activationUrl,
    passKitUrl: loadResult.passKitUrl,
    giftCardId: referrerInfo.gift_card_id, // Существующая карта
    waitForPassKit: true,
    locationId: paymentLocationId
  })
}
```

### Email содержит:
- ✅ Gift Card GAN (тот же номер карты)
- ✅ QR код
- ✅ Ссылка на Apple Wallet
- ✅ **Новый баланс** (например, $20 если это вторая награда)

---

## 📊 Схема потока

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Friend использует referral код при бронировании          │
│    (booking.created webhook)                                │
│                                                             │
│    ✅ Friend получает $10 gift card                         │
│    ✅ Email отправляется СРАЗУ                               │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. Friend платит в первый раз                               │
│    (payment.updated webhook)                                │
│                                                             │
│    ┌─────────────────────────────────────┐                 │
│    │ У referrer НЕТ gift card?           │                 │
│    │ → Создать НОВУЮ карту + $10         │                 │
│    │ → Email отправляется                │                 │
│    └─────────────────────────────────────┘                 │
│                                                             │
│    ┌─────────────────────────────────────┐                 │
│    │ У referrer УЖЕ ЕСТЬ gift card?       │                 │
│    │ → Загрузить $10 на существующую     │                 │
│    │ → Email отправляется с новым балансом│                │
│    └─────────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

---

## ⚠️ Когда email НЕ отправляется

Email **НЕ отправляется** если:

1. ❌ **Email адрес отсутствует:**
   - `customer.email_address` = NULL
   - `giftCard.digitalEmail` = NULL
   - Логируется: `⚠️ Friend gift card email skipped – missing email address`

2. ❌ **Gift card не создан:**
   - Ошибка при создании gift card
   - `friendGiftCard.giftCardId` = NULL

3. ❌ **Gift card GAN отсутствует:**
   - `giftCardGan` = NULL или пусто
   - Логируется: `⚠️ Skipping gift card email – card number missing`

4. ❌ **Email отправка отключена:**
   - `DISABLE_EMAIL_SENDING = 'true'`
   - `EMAIL_ENABLED = 'false'`
   - Логируется, но не отправляется

5. ❌ **SendGrid не настроен:**
   - `SENDGRID_API_KEY` отсутствует
   - Логируется, но не отправляется

---

## 🔍 Как проверить, отправляется ли email

### 1. Проверить логи Vercel

Ищите в логах:
- `📧 Attempting to send gift card email to...` - попытка отправки
- `✅ Gift card email sent to...` - успешная отправка
- `⚠️ Friend gift card email skipped` - пропущено

### 2. Проверить базу данных

```sql
-- Проверить notification_events
SELECT * FROM notification_events 
WHERE channel = 'EMAIL' 
  AND template_type = 'OTHER'
ORDER BY created_at DESC
LIMIT 10;

-- Проверить customers с gift cards
SELECT 
  square_customer_id,
  given_name,
  email_address,
  gift_card_id,
  gift_card_gan,
  got_signup_bonus,
  first_payment_completed
FROM square_existing_clients
WHERE gift_card_id IS NOT NULL
ORDER BY updated_at DESC
LIMIT 10;
```

### 3. Проверить SendGrid Activity

1. Зайдите в [SendGrid Dashboard](https://app.sendgrid.com/) → Activity
2. Ищите emails с subject: `🎁 $10.00 gift card from Zorina Nail Studio`

---

## 📝 Важные детали

### Wait for PassKit URL

По умолчанию `waitForPassKit: true` означает:
- Система ждет получения PassKit URL от Square (до 30 секунд)
- Это нужно для включения кнопки "Add to Apple Wallet" в email
- Если PassKit URL не получен, email все равно отправляется, но без кнопки Wallet

### Email Template

Используется один и тот же шаблон для всех случаев:
- Friend получает новую карту
- Referrer получает новую карту
- Referrer получает обновление баланса

Разница только в:
- `amountCents` - сколько добавлено ($10)
- `balanceCents` - текущий баланс ($10, $20, $30...)
- `isReminder` - флаг для reminder emails (по умолчанию false)

---

## 🎯 Итого

**Email отправляется:**
1. ✅ Friend - сразу при бронировании с referral кодом
2. ✅ Referrer - когда friend платит (новая карта или обновление баланса)

**Email НЕ отправляется:**
- ❌ Если нет email адреса
- ❌ Если gift card не создан
- ❌ Если SendGrid не настроен
- ❌ Если email отправка отключена

