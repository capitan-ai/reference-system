# Новые клиенты: `first_visit_at` и дневная аналитика

## Зачем `first_visit_at` в `square_existing_clients`

Колонка задаёт **момент первого визита** в смысле продукта: при первом подходящем букинге (логика вебхука, см. `app/api/webhooks/square/referrals/route.js` — нет предыдущих букингов и нет prior service payments) в БД пишется время старта этого букинга из Square.

Для **ежедневных / недельных / месячных** отчётов удобно опираться на один стабильный маркер на клиента, а не пересчитывать `MIN(bookings.start_at)` каждый раз в разных местах.

## Как считается `new_customers` во вьюхе `analytics_appointments_by_location_daily`

Используется **эффективный первый визит**:

```text
first_visit_effective_at =
  COALESCE(
    square_existing_clients.first_visit_at,
    MIN(bookings.start_at) по статусам ACCEPTED и COMPLETED
  )
```

- Если вебхук уже выставил `first_visit_at` — он **приоритетен** (ровно то, что вы «ставите при первом букинге»).
- Если колонка ещё `NULL` (старые клиенты, пропущенный вебхук) — подставляется **fallback** из `bookings`, чтобы дневные счётчики не занижались. После бэкфилла (`scripts/backfill-square-existing-clients-first-visit-at.js`) везде будет заполненный `first_visit_at`, и вьюха всё равно даст тот же день, что и `MIN(bookings…)`, если данные согласованы.

Клиент считается **новым в конкретный Pacific-день** в строке локации, если в этот день у него есть **ACCEPTED**-букинг с активным сегментом **и** календарная дата первого визита в **America/Los_Angeles** совпадает с датой этого букинга (тот же день, что и раньше по смыслу «первый приём в этот день»).

## Про таймзону

В PostgreSQL `first_visit_at` хранится как **`timestamptz`**: это не «просто дата», а **мгновение** (обычно как приходит `start_at` из Square, в UTC). Для салона **календарный день** для отчётов задаётся явно:  
`DATE(first_visit_effective_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')`.

Так совпадает день с остальной аналитикой по букингам (там тот же Pacific). Если бы брать «дату в UTC», часть вечерних слотов попала бы на **другой календарный день**, чем в приложении салона.

## Недельные и месячные агрегаты

- Берите **дневные** строки из `analytics_appointments_by_location_daily` и суммируйте `new_customers` за интервал, **границы интервала** считайте в Pacific (неделя = набор `date` в LA, месяц = `date_trunc`/`EXTRACT` по Pacific-дате).
- Или стройте rollup из `square_existing_clients`:  
  `COUNT(*)` где `DATE(first_visit_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')` попадает в нужный диапазон — после бэкфилла это согласовано с вьюхой.

## Бэкфилл

Запуск (сначала dry-run):

```bash
node scripts/backfill-square-existing-clients-first-visit-at.js --dry-run
node scripts/backfill-square-existing-clients-first-visit-at.js
```

Обновляет только `first_visit_at IS NULL`, значение = `MIN(start_at)` по `bookings` со статусами `ACCEPTED`, `COMPLETED` для пары `(organization_id, square_customer_id)`.

После бэкфилла при необходимости пересоздайте вьюху:

```bash
node scripts/update-analytics-appointments-view.js
```
