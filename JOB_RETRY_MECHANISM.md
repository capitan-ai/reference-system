# Механизм повторной обработки failed jobs

## Как работает retry для giftcard_jobs

### Автоматический retry

Когда job падает с ошибкой:

1. **Проверка возможности retry:**
   - `shouldRetry = attempts < maxAttempts`
   - По умолчанию `maxAttempts = 5`
   - Значит, job будет повторяться до 5 раз

2. **Если `shouldRetry = true`:**
   - Статус устанавливается в `'queued'`
   - `scheduled_at` устанавливается в будущее время с задержкой (backoff)
   - Job будет автоматически обработан снова, когда `scheduled_at <= NOW()`

3. **Если `shouldRetry = false` (attempts >= 5):**
   - Статус устанавливается в `'error'` (dead letter queue)
   - Job больше **НЕ обрабатывается автоматически**
   - Требуется ручное вмешательство

### Backoff Delay (экспоненциальная задержка)

Формула: `delay = 5000 * 2^(attempts-1)` секунд, максимум 5 минут

| Попытка | Задержка | Когда будет обработан |
|---------|----------|----------------------|
| 1 (первая ошибка) | 5 сек | Через 5 секунд |
| 2 | 10 сек | Через 10 секунд |
| 3 | 20 сек | Через 20 секунд |
| 4 | 40 сек | Через 40 секунд |
| 5 | 80 сек (1.3 мин) | Через 80 секунд |
| 6+ | - | Статус = 'error', не обрабатывается |

### Circuit Breaker

После 3 последовательных ошибок на одном stage:
- Открывается circuit breaker на 60 секунд (по умолчанию)
- Jobs для этого stage не обрабатываются, пока breaker открыт
- Другие stages продолжают работать

### Пример для клиента с ошибкой personal_code

**Сценарий:** Клиент Kate Rodgers (KATE1520) получил ошибку дубликата

1. **Попытка 1:** Ошибка → статус `queued`, `scheduled_at = NOW() + 5 сек`
2. **Попытка 2 (через 5 сек):** Ошибка → статус `queued`, `scheduled_at = NOW() + 10 сек`
3. **Попытка 3 (через 10 сек):** Ошибка → статус `queued`, `scheduled_at = NOW() + 20 сек`
4. **Попытка 4 (через 20 сек):** Ошибка → статус `queued`, `scheduled_at = NOW() + 40 сек`
5. **Попытка 5 (через 40 сек):** Ошибка → статус `error` (dead letter queue)

**Важно:** С нашими исправлениями:
- Теперь есть функция `generateUniquePersonalCode()` которая проверяет уникальность
- Есть retry loop (до 3 попыток) при ошибке дубликата
- Ошибка не должна происходить, но если произойдет - job будет повторен автоматически

### Проверка статуса jobs

```sql
-- Jobs в очереди (будут обработаны)
SELECT id, correlation_id, stage, attempts, status, scheduled_at, last_error
FROM giftcard_jobs
WHERE status = 'queued'
ORDER BY scheduled_at ASC;

-- Failed jobs (dead letter queue - требуют ручного вмешательства)
SELECT id, correlation_id, stage, attempts, status, scheduled_at, last_error
FROM giftcard_jobs
WHERE status = 'error'
ORDER BY updated_at DESC;
```

### Настройка задержки retry для failed jobs

По умолчанию failed jobs (после maxAttempts) повторяются через 24 часа.

Можно настроить через переменную окружения:
```bash
GIFTCARD_FAILED_JOB_RETRY_HOURS=6  # Retry через 6 часов
GIFTCARD_FAILED_JOB_RETRY_HOURS=12 # Retry через 12 часов
GIFTCARD_FAILED_JOB_RETRY_HOURS=24 # Retry через 24 часа (по умолчанию)
```

### Ручной requeue failed job

Если нужно обработать job немедленно (не ждать scheduled_at):

```sql
UPDATE giftcard_jobs
SET 
  status = 'queued',
  scheduled_at = NOW(),
  attempts = 0,
  last_error = NULL
WHERE id = 'JOB_ID';
```

Или для всех failed jobs:
```sql
UPDATE giftcard_jobs
SET 
  status = 'queued',
  scheduled_at = NOW(),
  attempts = 0,
  last_error = NULL
WHERE status = 'queued' 
  AND scheduled_at > NOW()
  AND attempts >= max_attempts;
```

### Cron обработка

- Vercel cron запускается каждую минуту
- Обрабатывает до 10 jobs за раз (настраивается через `GIFTCARD_JOBS_PER_CRON_RUN`)
- Берет jobs со статусом `queued` где `scheduled_at <= NOW()`

## Вывод

✅ **Да, jobs с ошибками обрабатываются повторно автоматически:**
- До 5 попыток с экспоненциальной задержкой
- После 5 попыток - статус `error`, требуется ручное вмешательство
- С нашими исправлениями ошибка personal_code должна быть исправлена, и job должен успешно обработаться

