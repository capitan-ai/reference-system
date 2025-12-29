# Улучшения валидации Referral кодов

## 🎯 Проблема

Клиентка использовала свой собственный referral код в своем букинге и получила $10, что является злоупотреблением системой.

## ✅ Реализованные улучшения

### 1. Строгая валидация перед выдачей награды

**Проверки:**
- ✅ `isSelfReferral` - Customer ID совпадает с Referrer ID
- ✅ `isOwnCode` - Customer использует свой собственный `personal_code`
- ✅ `isKnownReferrer` - Customer уже активирован как referrer

**Логика:**
```javascript
if (isSelfReferral || isOwnCode || isKnownReferrer) {
  // Блокировать и не выдавать награду
  // Не сохранять referral code в used_referral_code
  // Записать событие для мониторинга
}
```

### 2. Ранняя проверка (Early Validation)

Проверка происходит **ДО** сохранения `used_referral_code` в базу данных:
- Если клиент пытается использовать свой `personal_code`, код блокируется сразу
- Экономит ресурсы и предотвращает сохранение невалидных данных

### 3. Улучшенное логирование

**Добавлено:**
- 📋 Customer ID, name, personal_code
- 📋 Referrer ID, name, personal_code
- 📍 Источник referral code (где был найден)
- 🔒 Детали всех проверок валидации
- ❌ Причина блокировки (если заблокировано)

**Пример лога:**
```
🎁 Customer used referral code: BOZHENA8884
   📋 Customer ID: CUSTOMER_123
   📋 Customer name: Jane Doe
   📋 Customer personal_code: JANE1234
   📍 Code source: customer.custom_attributes[square:xxx-xxx-xxx]
👤 Found referrer: Bozhena Smith
   📋 Referrer ID: REFERRER_456
   📋 Referrer personal_code: BOZHENA8884
   🔒 Validation checks:
      - Is self-referral (same customer ID): false
      - Is own code (personal_code matches): false
      - Is known referrer: false
   ✅ Validation passed - referral code is valid
```

### 4. Улучшенное извлечение referral code из Square webhooks

**Проверяются все возможные места:**
1. `serviceVariationCapabilityDetails` - extension data
2. `booking.custom_fields` - кастомные поля букинга
3. `appointment_segments.custom_fields` - кастомные поля сегментов
4. `customer.custom_attributes['referral_code']` - специальный ключ
5. `customer.custom_attributes[*]` - все значения (включая Square-generated keys)

**Важно:** Код проверяет ВСЕ значения в custom attributes, включая ключи вида `square:xxx-xxx-xxx`, потому что Square может хранить referral code под любым ключом.

### 5. Запись заблокированных попыток

При блокировке создается событие в `ReferralEvent`:
```javascript
{
  eventType: 'CUSTOM',
  metadata: {
    referralCode,
    blocked: true,
    reason: 'customer_used_own_personal_code' | 'self_referral' | 'known_referrer',
    bookingId,
    customerPersonalCode
  }
}
```

Это позволяет отслеживать попытки злоупотребления.

## 🔍 Как проверить работу

### 1. Проверить логи webhook

В Vercel logs ищите:
- `🎁 Customer used referral code:` - когда код найден
- `❌ BLOCKED:` - когда код заблокирован
- `✅ Validation passed` - когда код валиден

### 2. Проверить базу данных

```sql
-- Проверить заблокированные попытки
SELECT * FROM referral_events 
WHERE metadata->>'blocked' = 'true'
ORDER BY created_at DESC;

-- Проверить использованные коды
SELECT square_customer_id, personal_code, used_referral_code 
FROM square_existing_clients 
WHERE used_referral_code IS NOT NULL;
```

### 3. Запустить тест извлечения

```bash
node scripts/test-referral-code-extraction.js
```

## 📊 Ожидаемое поведение

### ✅ Валидный сценарий:
1. Новый клиент использует чужой referral код
2. Система находит referrer в базе
3. Проверяет, что это не self-referral
4. Выдает $10 gift card клиенту
5. Сохраняет `used_referral_code`

### ❌ Заблокированный сценарий:
1. Клиент пытается использовать свой собственный код
2. Система находит, что `customer.personal_code === referralCode`
3. **Блокирует** выдачу награды
4. **НЕ сохраняет** `used_referral_code`
5. Записывает событие блокировки

## 🚀 Деплой

Изменения задеплоены в production:
- ✅ Улучшенная валидация
- ✅ Улучшенное логирование
- ✅ Ранняя проверка
- ✅ Запись заблокированных попыток

## 📝 Мониторинг

Рекомендуется периодически проверять:
1. Количество заблокированных попыток
2. Логи webhook на наличие блокировок
3. Статистику использования referral кодов

