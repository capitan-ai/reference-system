# Настройка SendGrid для уведомлений

## 🤔 Что такое SendGrid?

**SendGrid** - это сервис для отправки email. Ваша система использует его для отправки всех email, включая:
- Реферальные коды клиентам
- Gift card уведомления
- **Уведомления администратору об использовании реферальных кодов**

## ✅ Что нужно для работы

### 1. Аккаунт SendGrid
- Зарегистрируйтесь на [sendgrid.com](https://sendgrid.com)
- Бесплатный план позволяет отправлять до 100 email в день

### 2. API ключ SendGrid

**Как получить:**
1. Зайдите в SendGrid Dashboard
2. Settings → API Keys
3. Create API Key
4. Назовите ключ (например, "Zorina Referral System")
5. Выберите права: **Full Access** или **Mail Send** (достаточно)
6. Скопируйте ключ (показывается только один раз!)

### 3. Переменные окружения

Добавьте в Vercel или `.env.local`:

```bash
# Обязательно
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Откуда отправлять (ваш email или домен)
FROM_EMAIL=noreply@yourdomain.com
# или
FROM_EMAIL=info@studiozorina.com

# Email администратора для уведомлений
ADMIN_EMAIL=your-email@example.com
```

## 🔍 Как проверить, что SendGrid настроен

### Вариант 1: Через скрипт

```bash
node scripts/check-sendgrid-config.js
```

### Вариант 2: Через API endpoint

Откройте в браузере:
```
https://your-app.vercel.app/api/debug-sendgrid-status
```

### Вариант 3: Проверить переменные

```bash
# В Vercel
Settings → Environment Variables

# Должны быть:
✅ SENDGRID_API_KEY
✅ FROM_EMAIL
✅ ADMIN_EMAIL (для уведомлений)
```

## 📧 Что происходит, если SendGrid не настроен?

### Если нет `SENDGRID_API_KEY`:
```
⚠️ SendGrid API key not configured. Would send referral usage notification to admin@example.com
   Referral Code: BOZHENA8884
   Customer: John Doe
   Referrer: Jane Smith
   To enable email sending, configure SENDGRID_API_KEY environment variable
```

**Результат:** Email не отправляется, но система продолжает работать. Информация только в логах.

### Если нет `ADMIN_EMAIL`:
```
⚠️ ADMIN_EMAIL or REFERRAL_NOTIFICATION_EMAIL not configured. Skipping admin notification.
```

**Результат:** Уведомления не отправляются.

## 🚀 Быстрая настройка

### Шаг 1: Получить API ключ
1. [sendgrid.com](https://sendgrid.com) → Sign Up (если нет аккаунта)
2. Settings → API Keys → Create API Key
3. Скопируйте ключ

### Шаг 2: Добавить в Vercel
1. Vercel Dashboard → Ваш проект
2. Settings → Environment Variables
3. Добавьте:
   - `SENDGRID_API_KEY` = ваш ключ
   - `FROM_EMAIL` = ваш email (например, `noreply@yourdomain.com`)
   - `ADMIN_EMAIL` = куда отправлять уведомления

### Шаг 3: Проверить
1. Перезапустите deployment в Vercel
2. Проверьте через `/api/debug-sendgrid-status`
3. При следующем использовании реферального кода вы получите email

## 🔐 Безопасность

- **НЕ** коммитьте `SENDGRID_API_KEY` в git
- Храните только в переменных окружения
- Используйте разные ключи для dev/production

## 💰 Стоимость

- **Бесплатный план:** 100 email/день
- **Essentials:** $19.95/месяц - 50,000 email/месяц
- Для уведомлений администратору бесплатного плана обычно достаточно

## ❓ FAQ

**Q: Можно ли использовать другой email сервис?**  
A: В текущей версии используется только SendGrid. Можно добавить поддержку других сервисов, но потребуется изменение кода.

**Q: Что если я не хочу настраивать SendGrid?**  
A: Уведомления не будут отправляться, но вся информация будет в логах. Система продолжит работать.

**Q: Как проверить, что email отправляются?**  
A: 
1. Проверьте SendGrid Dashboard → Activity
2. Проверьте логи в Vercel
3. Проверьте папку спам (если не приходит)

**Q: Можно ли отправлять на несколько email?**  
A: В текущей версии - только один `ADMIN_EMAIL`. Можно использовать email forwarding или настроить группу в SendGrid.

**Q: Нужно ли верифицировать домен?**  
A: Для небольшого объема (до 100/день) можно использовать без верификации. Для большего объема рекомендуется верифицировать домен.

## 📝 Пример настройки

```bash
# .env.local (для локальной разработки)
SENDGRID_API_KEY=SG.abc123def456...
FROM_EMAIL=noreply@studiozorina.com
ADMIN_EMAIL=admin@studiozorina.com

# Vercel Environment Variables (для production)
SENDGRID_API_KEY=SG.abc123def456...
FROM_EMAIL=noreply@studiozorina.com
ADMIN_EMAIL=admin@studiozorina.com
```

---

**Полезные ссылки:**
- [SendGrid Dashboard](https://app.sendgrid.com)
- [SendGrid Documentation](https://docs.sendgrid.com)
- [API Keys Guide](https://docs.sendgrid.com/ui/account-and-settings/api-keys)

