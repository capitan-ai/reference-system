# Fix Apple Wallet URL - Use Custom Domain

## Проблема

В email был Vercel preview URL вместо кастомного домена:
```
https://referral-system-salon-fbbq6x1wt-umis-projects-e802f152.vercel.app/api/wallet/pass/...
```

## Решение

Нужно установить правильный `APP_BASE_URL` в Vercel environment variables.

### Шаги:

1. **Перейдите в Vercel Dashboard:**
   - Ваш проект → Settings → Environment Variables

2. **Найдите или создайте переменную:**
   ```
   APP_BASE_URL
   ```

3. **Установите значение:**
   ```
   https://zorinastudio-referral.com
   ```
   ⚠️ **Важно:** Без trailing slash в конце!

4. **Проверьте другие переменные:**
   - `NEXT_PUBLIC_APP_URL` тоже должен быть `https://zorinastudio-referral.com`

5. **Передеплойте:**
   - Vercel автоматически передеплоит после изменения environment variables
   - Или сделайте новый commit

## После исправления

Все ссылки в email будут использовать правильный домен:
```
https://zorinastudio-referral.com/api/wallet/pass/[gan]
```

## Проверка

После деплоя проверьте:
1. Откройте email с gift card
2. Нажмите "Add to Apple Wallet"
3. URL должен быть: `https://zorinastudio-referral.com/api/wallet/pass/...`

## Текущий код

Код уже правильный - он использует `process.env.APP_BASE_URL`:
- `lib/email-service-simple.js` - использует `APP_BASE_URL`
- `app/api/wallet/pass/[gan]/route.js` - использует `APP_BASE_URL`

Просто нужно установить правильное значение в Vercel!

