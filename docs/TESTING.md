# Проверка API «За столом»

| Что | Адрес |
| --- | --- |
| Базовый адрес API | `https://mail.lonelycraft.ru/banquet/api/v1` |
| Swagger UI | `https://mail.lonelycraft.ru/banquet/swagger/` |
| OpenAPI 3.1 | `https://mail.lonelycraft.ru/banquet/openapi.yaml` (в репозитории — [openapi.yaml](../openapi.yaml)) |
| Сценарий обязательных проверок | `https://mail.lonelycraft.ru/banquet/DATA-API.yaml` ([исходный файл](../DATA-API.yaml)) |
| Тестовые данные | `https://mail.lonelycraft.ru/banquet/fixtures/api-checks.json` ([исходный файл](../fixtures/api-checks.json)) |

Все пути ниже указаны относительно базового адреса. Ответы — JSON без обёртки, ошибки — `{"error":"текст"}`, деньги — целые копейки. Защищённые методы принимают заголовок `Authorization: Bearer <token>`.

## Тестовые учётные записи

Настоящий вход выполняется только внутри мессенджера MAX: мини-приложение передаёт подписанный `initData` в `POST /auth/max`, подделать его нельзя. Для проверки используются **тестовые учётные записи демо-режима**. `POST /auth/demo` создаёт изолированное пространство с синтетическим рестораном, меню и банкетом и выдаёт токен нужной роли. Из демо-пространства нет доступа к реальным данным, а токен действует 24 часа.

| Роль | Кто это | Как получить токен |
| --- | --- | --- |
| `organizer` | Организатор мероприятия | `POST /auth/demo` с `{"role":"organizer"}` → `token`, `sandbox` |
| `guest` | Гость мероприятия | `POST /auth/demo` с `{"role":"guest","sandbox":"<sandbox>"}` |
| `restaurant` | Администратор ресторана (управляющий) | `POST /auth/demo` с `{"role":"restaurant","sandbox":"<sandbox>"}` |
| `admin` | Администратор сервиса | `POST /auth/demo` с `{"role":"admin","sandbox":"<sandbox>"}` |

Любой вошедший пользователь может создать банкет и становится его организатором; права организатора распространяются только на его банкеты.

`sandbox` из первого ответа подключает остальные роли к тому же пространству: так организатор, гость и администраторы видят один и тот же банкет. Права администраторов действуют только внутри этого демо-пространства. В демо один ресторан — «Петръ · демо» с залом и пакетными предложениями.

Для самостоятельной проверки жюри может начать с `POST /auth/demo` и телом `{"role":"admin"}`: ответ сразу содержит токен администратора сервиса и `sandbox`. Предварительная регистрация и обращение к команде не нужны. Если проверка длится более 24 часов, получите новый токен тем же запросом; демо-пространство сохраняется 7 суток, пока известен его `sandbox`.

Если жюри необходимо проверить полномочия на личном аккаунте MAX и реальных данных, действующий администратор сервиса заранее назначает их числовой MAX ID во вкладке «Доступы» → «Добавить человека» → «Администратор сервиса». ID можно получить командой `/id` боту [@t266_hakaton_max_bot](https://max.ru/t266_hakaton_max_bot). Через API то же действие выполняет только действующий администратор: `PUT /admins/{MAX_ID}` с телом `{"enabled":true}` и его собственным токеном сессии. Для проверки изолированной демоверсии назначение личного аккаунта не требуется. Токен бота MAX никогда не передаётся проверяющим.

## Автоматическая проверка

```bash
npm ci
npm run api:check
```

Скрипт [scripts/api-check.mjs](../scripts/api-check.mjs) выполняет по порядку все проверки из `DATA-API.yaml` против production и печатает результат по каждой. Чтобы проверить другой адрес, передайте его аргументом: `node scripts/api-check.mjs http://localhost:3000/api/v1`. Каждый прогон начинается с нового демо-пространства, поэтому его можно повторять сколько угодно. Те же проверки выполняются в CI (`tests/data-api.test.mjs`) на каждом pull request.

## Пошаговая проверка вручную

Удобнее всего в Swagger UI:
1. В разделе «Вход и профиль» выполните `POST /auth/demo` с телом `{"role":"organizer"}`.
2. Скопируйте `token`, нажмите **Authorize** и вставьте его.
3. Дальше выполняйте запросы кнопкой **Try it out**.

Те же шаги через curl:

```bash
BASE=https://mail.lonelycraft.ru/banquet/api/v1
JSON='Content-Type: application/json'

# 1. Организатор: вход и ресторан
ORG=$(curl -s -X POST $BASE/auth/demo -H "$JSON" -d '{"role":"organizer"}')
ORG_TOKEN=$(echo "$ORG" | jq -r .token); SANDBOX=$(echo "$ORG" | jq -r .sandbox)
RESTAURANT=$(curl -s $BASE/restaurants -H "Authorization: Bearer $ORG_TOKEN" | jq -r '.[0].id')

# 2. Организатор создаёт банкет с бюджетом на гостя (еда 3000 ₽, напитки 600 ₽)
EVENT=$(curl -s -X POST $BASE/events -H "$JSON" -H "Authorization: Bearer $ORG_TOKEN" \
  -d "{\"restaurantId\":\"$RESTAURANT\",\"title\":\"Корпоратив\",\"date\":\"2027-12-20T15:00:00Z\",\"deadline\":\"2027-12-15T15:00:00Z\",\"expectedGuests\":10,\"foodBudget\":300000,\"drinkBudget\":60000}")
EVENT_ID=$(echo "$EVENT" | jq -r .id); CODE=$(echo "$EVENT" | jq -r .inviteCode)
MENU=$(curl -s $BASE/events/$EVENT_ID -H "Authorization: Bearer $ORG_TOKEN" | jq .menu)
SNACK=$(echo "$MENU" | jq -r '[.[] | select(.category=="Холодные закуски")][0].id')
MAIN=$(echo "$MENU" | jq -r '[.[] | select(.category=="Горячее")][0].id')

# 3. Организатор ставит закуски на общий стол
curl -s -X PUT $BASE/events/$EVENT_ID/shared -H "$JSON" -H "Authorization: Bearer $ORG_TOKEN" \
  -d "{\"items\":[{\"menuItemId\":\"$SNACK\",\"quantity\":2}]}"

# 4. Гость присоединяется по приглашению и выбирает блюдо
GUEST_TOKEN=$(curl -s -X POST $BASE/auth/demo -H "$JSON" -d "{\"role\":\"guest\",\"sandbox\":\"$SANDBOX\"}" | jq -r .token)
curl -s -X POST $BASE/invites/$CODE/join -H "Authorization: Bearer $GUEST_TOKEN"
curl -s -X PUT $BASE/events/$EVENT_ID/selection -H "$JSON" -H "Authorization: Bearer $GUEST_TOKEN" \
  -d "{\"items\":[{\"menuItemId\":\"$MAIN\",\"quantity\":1}],\"notes\":\"Без лука\"}"

# 5. Организатор утверждает заказ по актуальной ревизии
REV=$(curl -s $BASE/events/$EVENT_ID -H "Authorization: Bearer $ORG_TOKEN" | jq .event.revision)
curl -s -X POST $BASE/events/$EVENT_ID/approve -H "$JSON" -H "Authorization: Bearer $ORG_TOKEN" -d "{\"expectedRevision\":$REV}"

# 6. Администратор ресторана: кухня и выгрузка в Excel
ADMIN_TOKEN=$(curl -s -X POST $BASE/auth/demo -H "$JSON" -d "{\"role\":\"restaurant\",\"sandbox\":\"$SANDBOX\"}" | jq -r .token)
curl -s $BASE/kitchen -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.[0].summary'
curl -s -o kitchen.xlsx "$BASE/kitchen/export?format=xlsx" -H "Authorization: Bearer $ADMIN_TOKEN"
```

Ожидаемые результаты по каждому шагу — коды ответа, тип содержимого и обязательные поля — перечислены в `DATA-API.yaml`. Там же есть отрицательные проверки:
- без токена ответ `401`;
- гость не меняет чужой банкет и не утверждает заказ: `403`;
- выбор дороже бюджета отклоняется: `409`;
- позицию общего стола гостю заказать нельзя: `400`;
- организатору недоступны кухня и меню ресторана: `403`.
- после утверждения организатор не может удалить банкет: `403`; администратор ресторана может: `200` с `success: true`.

## Живой режим (MAX)

Внутри MAX администраторы сервиса определяются по `RESTAURANT_ADMIN_IDS` или назначением другого администратора сервиса. Они назначают администраторов конкретных ресторанов во вкладке «Доступы». Создатель банкета получает права организатора только для него; других организаторов на этот банкет назначает действующий организатор или администратор ресторана. Гость подтверждает телефон через `requestContact()` и выбирает блюда только за себя. Для проверки API все основные сценарии воспроизводятся в изолированном демо.
