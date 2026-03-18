# Контракт: New vs Rebook для букингов, созданных админом

## 1. Scope

Метрики `bookings_created_new_client_count` и `bookings_created_rebooking_count` считаются по **всем букингам, созданным админом** (created-by-admin).

**Denominator:** все created-by-admin bookings с `customer_id`.

---

## 2. Определение created-by-admin

Букинг считается созданным админом, если выполняется хотя бы одно из условий:

- `creator_type = 'TEAM_MEMBER'`
- `raw_json->'creator_details'->>'creator_type' = 'TEAM_MEMBER'`
- `EXISTS (SELECT 1 FROM team_members tm WHERE tm.square_team_member_id = b.raw_json->'creator_details'->>'team_member_id' AND tm.organization_id = b.organization_id)`

**Требование (source):** Букинг считается created-by-admin только если `source` (или `raw_json->>'source'`) = `FIRST_PARTY_MERCHANT` или `source IS NULL` (legacy). `FIRST_PARTY_MERCHANT` = создан продавцом (сотрудником) через Square Appointments. Исключаются `FIRST_PARTY_BUYER`, `THIRD_PARTY_BUYER`, `API` и др.

---

## 3. Классификация

Каждый created-by-admin booking классифицируется ровно в одну категорию:

| Классификация | Условие |
|---------------|---------|
| **REBOOKING** | До текущего букинга у клиента есть хотя бы один `Payment` со статусом `COMPLETED`, связанный с букингом этого клиента, который по порядку `(start_at, created_at, booking_id)` идёт раньше |
| **NEW_CLIENT** | Prior paid нет |

---

## 4. Prior paid

**Prior paid** = у клиента есть хотя бы один `Payment` со статусом `COMPLETED`, связанный с букингом, который по порядку идёт **раньше** текущего.

**Порядок (ordering):** `(start_at, created_at, booking_id)` ASC. «До» = строго меньше в лексикографическом порядке.

**Scope:** `organization_id` — prior ищется в рамках организации.

---

## 5. Timezone

Все day/month bucket'ы считаются в `America/Los_Angeles`.

---

## 6. Snapshot и immutability

Результат сохраняется в `admin_created_booking_facts` как snapshot.

**Immutable поля** (не перезаписывать при последующих refresh):
- `administrator_id_snapshot`, `administrator_name_snapshot`
- `creator_type_snapshot`, `creator_resolution_source`
- `created_at_utc`, `start_at_utc`
- `created_day_pacific`, `visit_day_pacific`, `created_month_pacific`, `visit_month_pacific`

**Mutable поля** (в correction window):
- `classification_snapshot`, `classification_reason_snapshot`
- `prior_paid_exists`, `snapshot_calculated_at`

**Correction window:** classification может обновляться только для записей, где `created_at_utc` в пределах последних N дней (например, 35).

---

## 7. Оговорка (множественные NEW_CLIENT)

**Важно:** Контракт prior paid **не означает**, что только один booking клиента будет NEW_CLIENT.

**Пример:**
- Клиент новый.
- Админ создал: booking A (сегодня), booking B (следующая неделя).
- До booking B у клиента ещё нет completed payment.
- Результат: **A = NEW_CLIENT, B = тоже NEW_CLIENT.**

Критерий rebooking — не «был ли prior booking», а «был ли prior paid».

> **Оговорка (множественные NEW_CLIENT):** По дизайну несколько created-by-admin bookings одного и того же клиента могут классифицироваться как NEW_CLIENT, если на момент каждого из них у клиента ещё не было prior completed payment, связанного с более ранним booking. Это ожидаемое поведение, а не ошибка расчёта.

---

## 8. Явная оговорка по ACCEPTED

Если у клиента был ранее `ACCEPTED` букинг, но **не было** completed payment, такой клиент всё ещё может попасть в `NEW_CLIENT`. Это следствие бизнес-определения: rebooking = только если клиент уже точно оплатил.
