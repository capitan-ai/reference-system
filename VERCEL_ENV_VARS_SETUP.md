# Vercel Environment Variables Setup для Apple Wallet

## ❌ Текущая проблема

Endpoint возвращает ошибку:
```
"Apple Wallet certificates not configured. Please check your .env file."
```

## ✅ Решение: Добавить Environment Variables в Vercel

### Шаг 1: Перейдите в Vercel Dashboard

1. Откройте https://vercel.com/dashboard
2. Выберите ваш проект
3. Settings → Environment Variables

### Шаг 2: Добавьте эти переменные

#### Обязательные переменные:

1. **APPLE_PASS_TYPE_ID**
   ```
   pass.com.zorinastudio.giftcard
   ```

2. **APPLE_PASS_CERTIFICATE_BASE64**
   - Запустите: `node scripts/encode-certificates-for-vercel.js`
   - Скопируйте значение для `APPLE_PASS_CERTIFICATE_BASE64`
   - Вставьте в Vercel

3. **APPLE_WWDR_CERTIFICATE_BASE64**
   - Из того же скрипта
   - Скопируйте значение для `APPLE_WWDR_CERTIFICATE_BASE64`
   - Вставьте в Vercel

4. **APPLE_PASS_CERTIFICATE_PASSWORD**
   ```
   Step7nett.Umit
   ```

5. **APPLE_PASS_TEAM_ID**
   ```
   MXAWQYBV2L
   ```

6. **APP_BASE_URL** (если еще не установлен)
   ```
   https://zorinastudio-referral.com
   ```
   ⚠️ Без `/` в конце!

### Шаг 3: Выберите Environment

Для каждой переменной выберите:
- ✅ Production
- ✅ Preview  
- ✅ Development

(Или только Production, если нужно)

### Шаг 4: Сохраните и передеплойте

1. Нажмите "Save"
2. Vercel автоматически начнет новый деплой
3. Дождитесь завершения деплоя

### Шаг 5: Проверьте

После деплоя проверьте:
```bash
node scripts/test-wallet-endpoint.js 2A47E49DFEAC4394 https://zorinastudio-referral.com
```

Должно быть: `✅ Success! Pass file generated`

## 📋 Полный список переменных

```
APPLE_PASS_TYPE_ID=pass.com.zorinastudio.giftcard
APPLE_PASS_CERTIFICATE_BASE64=<из скрипта>
APPLE_WWDR_CERTIFICATE_BASE64=<из скрипта>
APPLE_PASS_CERTIFICATE_PASSWORD=Step7nett.Umit
APPLE_PASS_TEAM_ID=MXAWQYBV2L
APP_BASE_URL=https://zorinastudio-referral.com
```

## 🔍 Как получить base64 сертификаты

```bash
node scripts/encode-certificates-for-vercel.js
```

Скопируйте значения и вставьте в Vercel.

## ⚠️ Важно

- Сертификаты чувствительные данные - храните их безопасно
- После добавления переменных обязательно передеплойте
- Проверьте, что все переменные добавлены для Production environment

