# 🔐 Apple Wallet Environment Variables для Vercel

## 📋 Обязательные переменные

Добавьте эти переменные в **Vercel Dashboard** → **Settings** → **Environment Variables** → **Production**:

### 1. Основные настройки

```env
APPLE_PASS_TYPE_ID=pass.com.zorinastudio.giftcard
APPLE_PASS_TEAM_ID=MXAWQYBV2L
```

### 2. Сертификаты (PEM формат - рекомендуется)

```env
APPLE_PASS_CERTIFICATE_PEM_BASE64=<base64_encoded_certificate>
APPLE_PASS_KEY_PEM_BASE64=<base64_encoded_private_key>
APPLE_WWDR_CERTIFICATE_BASE64=<base64_encoded_wwdr_certificate>
APPLE_PASS_CERTIFICATE_PASSWORD=Step7nett.Umit
```

## 📝 Как получить base64 строки

### Шаг 1: Конвертируйте .p12 в PEM

```bash
# 1. Извлеките сертификат
openssl pkcs12 -in Certificates.p12 -clcerts -nokeys -out pass-cert.pem

# 2. Извлеките приватный ключ
openssl pkcs12 -in Certificates.p12 -nocerts -out pass-key-encrypted.pem

# 3. Уберите пароль с ключа (опционально)
openssl rsa -in pass-key-encrypted.pem -out pass-key.pem
```

### Шаг 2: Закодируйте в base64

```bash
# Сертификат
base64 -i pass-cert.pem | tr -d '\n' > CERT_BASE64.txt

# Приватный ключ
base64 -i pass-key.pem | tr -d '\n' > KEY_BASE64.txt

# WWDR сертификат (скачайте с Apple)
base64 -i AppleWWDRCAG4.pem | tr -d '\n' > WWDR_BASE64.txt
```

### Шаг 3: Скопируйте содержимое .txt файлов в Vercel

## ✅ Проверка переменных

После добавления переменных в Vercel:

1. **Redeploy** проект (или подождите автоматический деплой)
2. Проверьте endpoint:
   ```bash
   node scripts/test-wallet-endpoint.js 2A47E49DFEAC4394 https://www.zorinastudio-referral.com
   ```

## 🔍 Где найти значения

| Переменная | Где найти |
|-----------|-----------|
| `APPLE_PASS_TYPE_ID` | Apple Developer → Certificates, IDs & Profiles → Pass Type IDs |
| `APPLE_PASS_TEAM_ID` | Apple Developer → Membership → Team ID |
| `APPLE_PASS_CERTIFICATE_PEM_BASE64` | Конвертируйте ваш .p12 сертификат в PEM и base64 |
| `APPLE_PASS_KEY_PEM_BASE64` | Извлеките приватный ключ из .p12 и base64 |
| `APPLE_WWDR_CERTIFICATE_BASE64` | Скачайте с [Apple Developer](https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer) и конвертируйте в PEM + base64 |
| `APPLE_PASS_CERTIFICATE_PASSWORD` | Пароль, который вы использовали при экспорте .p12 |
| `APPLE_WALLET_PUSH_ENABLED` *(опционально)* | Установите `false`, чтобы временно отключить push-уведомления |

## ⚠️ Важно

1. **Все переменные должны быть в Production environment** (или All environments)
2. **После добавления переменных нужен redeploy**
3. **Base64 строки должны быть БЕЗ пробелов и переносов строк**
4. **PEM формат предпочтительнее .p12** (более надежно на Vercel)

## 🆘 Если что-то не работает

1. Проверьте логи Vercel: **Deployments** → выберите деплой → **Functions** → выберите функцию
2. Проверьте, что все переменные добавлены в **Production**
3. Убедитесь, что base64 строки правильные (можно декодировать и проверить)

