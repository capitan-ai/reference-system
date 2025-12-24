# Как проверить логи Vercel для диагностики Apple Wallet

## Шаги для проверки логов:

1. **Откройте Vercel Dashboard**
   - https://vercel.com/dashboard
   - Войдите в свой аккаунт

2. **Выберите проект**
   - Найдите проект `referral-system-salon`
   - Откройте его

3. **Перейдите в Functions → Logs**
   - В меню слева найдите "Functions"
   - Нажмите "Logs"

4. **Фильтруйте логи**
   - В поиске введите: `/api/wallet/pass`
   - Или найдите последние запросы

5. **Что искать в логах:**

### ✅ Успешные сообщения:
- `✅ Using base64 encoded certificate (PEM) from environment variable`
- `✅ Using base64 encoded private key (PEM) from environment variable`
- `✅ Using base64 encoded WWDR certificate from environment variable`
- `📝 Creating PKPass programmatically (no template)`
- `Cert (PEM): /tmp/pass-cert.pem`
- `Key (PEM): /tmp/pass-key.pem`

### ❌ Проблемные сообщения:
- `Apple Wallet certificates not configured`
- `Certificate not found`
- `Private key not found`
- `Invalid PEM formatted message`
- `Error decoding certificate`
- `Error decoding private key`

## Если переменные не найдены:

Проверьте в Vercel Dashboard → Settings → Environment Variables:

1. **Убедитесь, что переменные добавлены:**
   - `APPLE_PASS_CERTIFICATE_PEM_BASE64`
   - `APPLE_PASS_KEY_PEM_BASE64`
   - `APPLE_WWDR_CERTIFICATE_BASE64`
   - `APPLE_PASS_TYPE_ID`
   - `APPLE_PASS_TEAM_ID`
   - `APPLE_PASS_CERTIFICATE_PASSWORD`

2. **Проверьте Environment:**
   - Для каждой переменной должна быть галочка на **Production**

3. **Проверьте значения:**
   - Base64 строки должны быть полными (без обрезки)
   - Не должно быть лишних пробелов или переносов строк

## После проверки:

Если в логах видно, что переменные не найдены:
1. Удалите старые переменные (если есть)
2. Добавьте новые переменные из `VERCEL_PEM_KEYS.txt`
3. Сделайте **Redeploy** (Deployments → "..." → "Redeploy")
4. Подождите 2-3 минуты
5. Проверьте снова

