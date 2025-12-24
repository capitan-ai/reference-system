# Тестирование Apple Wallet после деплоя

## ✅ Что было развернуто

1. **Официальный бейдж "Add to Wallet"** в email-шаблонах
2. **Web Service API endpoints** для обновлений pass
3. **Таблица `device_pass_registrations`** в базе данных

## 🧪 Тесты

### 1. Проверка endpoint для получения pass

```bash
# Через curl
curl -I "https://www.zorinastudio-referral.com/api/wallet/pass/2A47E49DFEAC4394"

# Или через скрипт
node scripts/test-wallet-endpoint.js 2A47E49DFEAC4394 https://www.zorinastudio-referral.com
```

**Ожидаемый результат**: 
- Status: 200 OK
- Content-Type: `application/vnd.apple.pkpass`
- Файл `.pkpass` скачивается

### 2. Проверка Web Service API

#### GET /api/wallet/v1/passes/{passTypeIdentifier}/{serialNumber}

```bash
# Нужно получить auth token сначала
# Затем:
curl -H "Authorization: ApplePass {token}" \
  "https://www.zorinastudio-referral.com/api/wallet/v1/passes/pass.com.zorinastudio.giftcard/2A47E49DFEAC4394"
```

**Ожидаемый результат**: Обновленный `.pkpass` файл

#### GET /api/wallet/v1/devices/{deviceId}/registrations/{passTypeIdentifier}

```bash
curl "https://www.zorinastudio-referral.com/api/wallet/v1/devices/{deviceId}/registrations/pass.com.zorinastudio.giftcard"
```

**Ожидаемый результат**: JSON массив serial numbers (может быть пустым, если устройство не зарегистрировано)

### 3. Тест через Apple Wallet

1. **Отправить тестовый email**:
   ```bash
   node scripts/send-test-wallet-email.js 70WNH5QYS71S32NG7Z77YW4DA8 umit0912@icloud.com
   ```

2. **Проверить email**:
   - Должен отображаться официальный бейдж "Add to Wallet"
   - При клике должен скачиваться `.pkpass` файл

3. **Добавить pass в Apple Wallet**:
   - Открыть email на iPhone
   - Нажать на бейдж "Add to Wallet"
   - Pass должен добавиться в Wallet

4. **Проверить обновление баланса**:
   - Открыть pass в Apple Wallet
   - Потянуть вниз на обратной стороне pass (pull-to-refresh)
   - Баланс должен обновиться с актуальными данными из Square

### 4. Проверка базы данных

```bash
# Подключиться к базе и проверить таблицу
npx prisma studio
# Или через SQL:
# SELECT * FROM device_pass_registrations;
```

**Ожидаемый результат**: Таблица существует и готова к использованию

## 🔍 Проверка логов

В Vercel Dashboard → Functions → Logs можно проверить:
- Запросы к `/api/wallet/pass/[gan]`
- Запросы к `/api/wallet/v1/*` endpoints
- Ошибки (если есть)

## ✅ Критерии успеха

- [ ] Endpoint `/api/wallet/pass/[gan]` возвращает `.pkpass` файл
- [ ] Официальный бейдж отображается в email
- [ ] Pass можно добавить в Apple Wallet
- [ ] Pull-to-refresh обновляет баланс
- [ ] Web Service API endpoints отвечают корректно
- [ ] Нет ошибок в логах Vercel

## 🐛 Если что-то не работает

1. **Проверить environment variables в Vercel**:
   - `APPLE_PASS_TYPE_ID`
   - `APPLE_PASS_TEAM_ID`
   - `APPLE_PASS_CERTIFICATE_BASE64`
   - `APPLE_WWDR_CERTIFICATE_BASE64`
   - `APPLE_PASS_CERTIFICATE_PASSWORD`
   - `APP_BASE_URL`

2. **Проверить логи Vercel** на наличие ошибок

3. **Проверить базу данных** - миграция применена

4. **Проверить сертификаты** - они должны быть правильно закодированы в base64

