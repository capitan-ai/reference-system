# Apple Wallet Web Service API

Реализованы endpoints для автоматического обновления Apple Wallet passes согласно [Apple PassKit Web Service Reference](https://developer.apple.com/documentation/passkit/pkwebservice).

## Endpoints

### 1. GET `/api/wallet/v1/passes/{passTypeIdentifier}/{serialNumber}`
Получает последнюю версию pass для обновления.

**Аутентификация**: Требуется `Authorization: ApplePass {token}` header.

**Ответ**: `.pkpass` файл с обновленными данными (баланс, информация о клиенте).

### 2. GET `/api/wallet/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}`
Получает список всех serial numbers passes, зарегистрированных на устройстве.

**Ответ**: JSON массив serial numbers:
```json
["SERIAL1", "SERIAL2", ...]
```

### 3. POST `/api/wallet/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}`
Регистрирует устройство для получения push-уведомлений об обновлениях pass.

**Body** (опционально):
```json
{
  "pushToken": "device-push-token"
}
```

**Аутентификация**: Требуется `Authorization: ApplePass {token}` header.

### 4. DELETE `/api/wallet/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}`
Отменяет регистрацию устройства для получения обновлений pass.

**Аутентификация**: Требуется `Authorization: ApplePass {token}` header.

### 5. POST `/api/wallet/v1/log`
Принимает диагностические логи от устройств.

**Body**: JSON с логами от устройства.

## База данных

Создана таблица `device_pass_registrations` для хранения регистраций устройств:

```sql
CREATE TABLE "device_pass_registrations" (
    "deviceLibraryIdentifier" TEXT NOT NULL,
    "passTypeIdentifier" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "pushToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    PRIMARY KEY ("deviceLibraryIdentifier", "passTypeIdentifier", "serialNumber")
);
```

## Аутентификация

Все endpoints (кроме GET registrations и POST log) требуют аутентификации через `Authorization: ApplePass {token}` header.

Токен генерируется в `lib/wallet/pass-generator.js`:
```javascript
generateAuthToken(serialNumber)
```

Используется HMAC-SHA256 с секретом из `APPLE_PASS_AUTH_SECRET` или `SQUARE_WEBHOOK_SIGNATURE_KEY`.

## Web Service URL

В каждом pass устанавливается `webServiceURL`:
```
https://zorinastudio-referral.com/api/wallet/v1
```

Это позволяет Apple Wallet автоматически обращаться к серверу для обновлений.

## Обновление баланса

Когда баланс подарочной карты изменяется:

1. **Автоматическое обновление** (через push-уведомления):
   - Сервер отправляет push-уведомление на зарегистрированные устройства
   - Устройство получает уведомление и запрашивает обновленный pass
   - Endpoint `/api/wallet/v1/passes/{passTypeIdentifier}/{serialNumber}` возвращает новый pass с актуальным балансом

2. **Ручное обновление** (pull-to-refresh):
   - Пользователь тянет вниз на обратной стороне pass в Wallet
   - Устройство запрашивает обновленный pass
   - Endpoint возвращает актуальную версию

## Push-уведомления

Теперь push-уведомления полностью реализованы:

1. **Регистрация устройств** – Apple Wallet регистрирует устройство через `POST /devices/.../registrations/...`, мы сохраняем `pushToken`.
2. **Отправка уведомлений** – когда баланс подарочной карты меняется (пополнение, начисление бонуса, использование подарочной карты в платеже):
   - Сервер посылает push через APNs, используя Pass Type ID сертификат (`APPLE_PASS_CERTIFICATE_PEM_BASE64` + `APPLE_PASS_KEY_PEM_BASE64` или `APPLE_PASS_CERTIFICATE_BASE64`).
   - Payload содержит `serialNumber` и `passTypeIdentifier`, поэтому iOS обновляет только нужный pass.
3. **Фоновое обновление** – после получения push Wallet вызывает `GET /passes/{passTypeIdentifier}/{serialNumber}` и отображает актуальный баланс.
4. **Очистка токенов** – если APNs возвращает `Unregistered/BadDeviceToken`, запись в `device_pass_registrations` удаляется автоматически.

> ✅ Требования: задать `APPLE_PASS_CERTIFICATE_PEM_BASE64` и `APPLE_PASS_KEY_PEM_BASE64` (или p12-версию), а также `APPLE_PASS_CERTIFICATE_PASSWORD`, если сертификат защищён паролем.

## Миграция

Применить миграцию:
```bash
npx prisma migrate deploy
```

Или вручную:
```sql
CREATE TABLE IF NOT EXISTS "device_pass_registrations" (
    "deviceLibraryIdentifier" TEXT NOT NULL,
    "passTypeIdentifier" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "pushToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "device_pass_registrations_pkey" PRIMARY KEY ("deviceLibraryIdentifier", "passTypeIdentifier", "serialNumber")
);
```

## Тестирование

1. Добавьте pass в Apple Wallet
2. Измените баланс в Square
3. Потяните вниз на обратной стороне pass в Wallet (pull-to-refresh)
4. Pass должен обновиться с новым балансом

Или используйте curl для тестирования endpoints:
```bash
# Get updated pass
curl -H "Authorization: ApplePass {token}" \
  "https://zorinastudio-referral.com/api/wallet/v1/passes/pass.com.zorinastudio.giftcard/{serialNumber}"

# Get device registrations
curl "https://zorinastudio-referral.com/api/wallet/v1/devices/{deviceId}/registrations/pass.com.zorinastudio.giftcard"
```

