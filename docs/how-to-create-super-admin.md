# Как создать первого Super Admin

## 📋 Что нужно

1. **Supabase проект** с настроенным Authentication
2. **Email и password** для пользователя, которого хотите сделать super admin
3. **Доступ к базе данных** (через Supabase Dashboard или psql)

## 🚀 Пошаговая инструкция

### Шаг 1: Создать пользователя в Supabase Auth

1. Откройте [Supabase Dashboard](https://app.supabase.com)
2. Выберите ваш проект
3. Перейдите в **Authentication** → **Users**
4. Нажмите **"Add User"** или **"Invite User"**
5. Введите:
   - **Email**: ваш email (например, `admin@system.com`)
   - **Password**: надежный пароль
   - **Auto Confirm User**: включите (чтобы не нужно было подтверждать email)
6. Нажмите **"Create User"**
7. **ВАЖНО**: Скопируйте **User ID** (UUID) - он понадобится на следующем шаге

### Шаг 2: Получить User ID

User ID можно найти несколькими способами:

#### Вариант A: Через Supabase Dashboard
- В таблице Users найдите вашего пользователя
- Скопируйте значение из колонки **"UUID"**

#### Вариант B: Через SQL (если есть доступ)
```sql
SELECT id, email, created_at 
FROM auth.users 
WHERE email = 'your-email@example.com';
```

### Шаг 3: Создать Super Admin запись

Выполните SQL команду (замените `<YOUR_USER_ID>` на UUID из шага 2):

```sql
INSERT INTO organization_users (user_id, organization_id, role, is_primary)
VALUES (
  '<YOUR_USER_ID>',  -- UUID из Supabase Auth
  NULL,              -- Super admin не привязан к организации
  'super_admin',
  false
);
```

### Шаг 4: Проверить создание

```sql
SELECT 
    ou.id,
    ou.user_id,
    u.email,
    ou.role,
    ou.created_at
FROM organization_users ou
LEFT JOIN auth.users u ON ou.user_id = u.id
WHERE ou.role = 'super_admin';
```

Если видите вашу запись - super admin создан успешно! ✅

## 🔐 Альтернативный способ (через API)

После создания первого super admin, можно создавать других через API:

```javascript
POST /api/admin/super-admin/assign
Authorization: Bearer <super_admin_token>

{
  "email": "new-admin@system.com"
}
```

Но для первого super admin нужно использовать SQL (как описано выше).

## ✅ Проверка работы

После создания super admin, проверьте:

1. **Логин через Supabase Auth**:
   ```javascript
   const { data, error } = await supabase.auth.signInWithPassword({
     email: 'admin@system.com',
     password: 'your-password'
   })
   ```

2. **Получить информацию о пользователе**:
   ```javascript
   GET /api/auth/me
   Authorization: Bearer <session_token>
   ```
   
   Должен вернуть:
   ```json
   {
     "user": {
       "is_super_admin": true,
       "organizations": [...] // Все организации
     }
   }
   ```

3. **Проверить доступ к admin endpoints**:
   ```javascript
   GET /api/admin/organizations
   Authorization: Bearer <session_token>
   ```
   
   Должен вернуть список всех организаций.

## ⚠️ Важные замечания

- **Первый super admin** должен быть создан через SQL
- **Super admin** имеет доступ ко **всем организациям** автоматически
- **Super admin** может назначать других super admin через API
- **Безопасность**: Храните super admin credentials в безопасном месте

## 🆘 Troubleshooting

### Ошибка: "duplicate key value violates unique constraint"
- Пользователь уже является super admin
- Проверьте: `SELECT * FROM organization_users WHERE user_id = '<USER_ID>'`

### Ошибка: "violates check constraint"
- Убедитесь, что `organization_id = NULL` для super_admin
- Убедитесь, что `role = 'super_admin'`

### Пользователь не видит все организации
- Проверьте, что запись создана: `SELECT * FROM organization_users WHERE role = 'super_admin'`
- Проверьте, что используется правильный user_id из Supabase Auth



