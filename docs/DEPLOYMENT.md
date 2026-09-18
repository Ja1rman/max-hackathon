# Развёртывание «Банкет»

Публичный адрес: `https://mail.lonelycraft.ru/banquet/`. Существующий nginx завершает TLS и передаёт только `/banquet/` приложению. Контейнер слушает `127.0.0.1:3100` на сервере, внутри контейнера — `3000`. Существующий Mailu продолжает обслуживать свои маршруты.

## Состав

- Node.js 24, React/Vite, сервер на встроенных модулях Node.js и SQLite.
- Docker Compose, один контейнер приложения с пользователем `node`, файловой системой только для чтения и отдельным томом `banquet_data` для базы и резервных копий.
- Код релиза: `/srv/banquet/releases/<git-sha>`; текущий релиз: `/srv/banquet/current`.
- Секреты: `/srv/banquet/.env`, вне Git и архивов релизов.
- SQLite: `/data/banquet.sqlite`; согласованные резервные копии: `/data/backups/` внутри тома.

## Первичная подготовка сервера

Нужны Docker Engine, плагин Docker Compose v2, Python 3, `bash`, `flock`, `tar`, работающий HTTPS nginx и доступ `aboba` через SSH. На этом сервере Docker запускается через уже доступный `sudo -n`: workflow вызывает `sudo -n bash <release>/scripts/deploy.sh <sha>`. Добавлять пользователя в группу Docker не требуется. Команда должна выполняться без интерактивного ввода пароля; иначе deployment завершится ошибкой. Для GitHub настроен отдельный ключ развёртывания этого проекта; личный приватный SSH-ключ пользователя в GitHub не копируется.

Администратор однократно создаёт рабочий каталог:

```bash
sudo install -d -o aboba -g aboba -m 750 /srv/banquet /srv/banquet/releases
```

Создайте `/srv/banquet/.env` с правами `600`. Значения MAX заполняются после создания бота пользователем:

```dotenv
MAX_BOT_TOKEN=
MAX_BOT_USERNAME=
RESTAURANT_ADMIN_IDS=
MAX_WEBHOOK_SECRET=
DEMO_ENABLED=true
PUBLIC_URL=https://mail.lonelycraft.ru/banquet
VITE_BASE_PATH=/banquet/
TRUST_PROXY=true
```

`RESTAURANT_ADMIN_IDS` — список MAX user ID администраторов ресторана через запятую. `DEMO_ENABLED=true` предназначен для демонстрации: перед приёмом реальных заказов нужно настроить MAX и отключить демонстрационный доступ (`false`). Не добавляйте токены, приватный SSH-ключ и заполненный `.env` в репозиторий.

В существующий HTTPS `server` для `mail.lonelycraft.ru` добавьте содержимое `ops/nginx-banquet.conf`. Это фрагмент с `location`, а не полная замена конфигурации. Сначала сохраните копию существующего файла; затем проверьте конфигурацию и перезагрузите nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

На сервере фронтенд собирается с `VITE_BASE_PATH=/banquet/`; nginx удаляет этот префикс при проксировании, поэтому сервер получает `/api/...` и пути статических файлов без `/banquet`. `TRUST_PROXY=true` позволяет учитывать установленный nginx заголовок `X-Real-IP`; включайте его только при доступе к контейнеру через доверенный reverse proxy. Порт контейнера привязан к loopback сервера.

## Локальный Docker без nginx

В локальном `.env` используйте `PUBLIC_URL=http://localhost:3100`, `VITE_BASE_PATH=/` и `TRUST_PROXY=false`. Это значения из `.env.example`; Compose и Dockerfile по умолчанию собирают фронтенд для корня сайта.

```bash
cp .env.example .env
docker compose up -d --build
curl --fail http://localhost:3100/healthz
```

Интерфейс доступен по `http://localhost:3100/`. После изменения `VITE_BASE_PATH` нужно пересобрать образ: этот параметр применяется при сборке фронтенда. При запуске Node напрямую без Docker сервер по умолчанию использует порт `3000`.

## GitHub Actions

Добавьте **repository secrets**. Preflight job проверяет только их наличие, затем SSH-шаг использует значения для подключения; reusable workflow проверок их не получает. Секреты, заданные только в environment `production`, не подходят: preflight выполняется вне этого environment, чтобы пропущенный запуск не отображался как успешный production deployment.

| Секрет | Значение |
| --- | --- |
| `DEPLOY_HOST` | `mail.lonelycraft.ru` |
| `DEPLOY_USER` | `aboba` |
| `DEPLOY_SSH_KEY` | Приватная часть отдельного ключа проекта |
| `DEPLOY_KNOWN_HOSTS` | Проверенная строка host key сервера из `known_hosts` |

Публичная часть ключа должна быть добавлена в `authorized_keys` выбранного пользователя. Отпечаток host key проверяется через уже доверенное SSH-соединение или консоль сервера; одного непроверенного результата `ssh-keyscan` недостаточно. Workflow использует `StrictHostKeyChecking=yes`.

Все четыре секрета настроены 16 сентября 2026 года. Публичная часть отдельного Ed25519-ключа добавлена для `aboba` с опцией `restrict`: workflow использует SSH/SFTP без PTY и туннелей. Отпечаток ключа: `SHA256:b7r7uRds0m6mMZSdxXPjAld8Yo6pXBWZmcAEp2CKK8I`. Приватная часть находится в `DEPLOY_SSH_KEY`, а не в Git.

Если какой-либо секрет отсутствует, CI выполняет проверки, а deployment job получает статус `skipped`; Summary перечисляет отсутствующие настройки. Для ручного запуска используйте `Deploy production` → `Run workflow` → `main`. Для ротации добавьте новый публичный ключ, обновите `DEPLOY_SSH_KEY`, проверьте workflow и затем отзовите старый ключ по отпечатку.

`ci.yml` выполняет установку по lockfile, `npm test`, production-сборку, синтаксическую проверку shell-скриптов и Python unit tests синхронизации конфигурации для pull request. `deploy.yml` при push в `main` вызывает те же проверки и затем:

1. Упаковывает только отслеживаемые Git файлы для конкретного SHA.
2. Передаёт архив по SSH в новый каталог релиза.
3. Обновляет разрешённые непустые MAX-настройки в серверном `.env` через зашифрованный SSH stdin.
4. Собирает Docker-образ `banquet:<sha>` на сервере. Сбой сборки оставляет работающий контейнер на месте.
5. Создаёт и проверяет резервную копию SQLite до запуска нового кода.
6. Заменяет контейнер и ждёт успешного `/healthz`.
7. Переключает ссылку `current` только после успешной проверки. Если проверка не пройдена, возвращает предыдущий образ и его Compose-конфигурацию.

Параллельные production deployments запрещены GitHub concurrency и серверной блокировкой `flock`. Образы предыдущих релизов сохраняются для отката; периодическую очистку выполняйте отдельно, сохраняя нужные образы. Сборка на сервере не требует Container Registry и дополнительных токенов.

### MAX-настройки из GitHub Secrets

В deployment job можно передать четыре секрета: `MAX_BOT_TOKEN`, `MAX_BOT_USERNAME`, `MAX_WEBHOOK_SECRET`, `RESTAURANT_ADMIN_IDS`. Они доступны только SSH-шагу deployment, не передаются CI, preflight, аргументам Docker build или другим шагам. Для них допустимы repository secrets либо secrets environment `production`; требование repository scope выше относится к четырём `DEPLOY_*`-секретам.

После распаковки релиза workflow формирует JSON в памяти и передаёт его по stdin SSH в `sudo -n python3 <release>/scripts/sync-max-env.py`. Значения не включаются в командную строку, не записываются в промежуточный файл и не выводятся в логи. Скрипт принимает только перечисленные поля; пустые или отсутствующие значения сохраняют существующую настройку. Для удаления настройки нужно отдельно изменить серверный `.env`: удаление GitHub Secret не очищает уже установленный токен.

Скрипт отклоняет неизвестные поля, некорректный JSON, повторяющиеся JSON-ключи, управляющие символы (включая перенос строки и NUL) и превышение лимитов. Токен допускает до 4096 символов из набора букв, цифр и `._~+/=:-`; username — до 64 букв, цифр или `_` с необязательным `@`; webhook secret — от 5 до 256 букв, цифр, `_` или `-`; администраторы — до 100 положительных числовых ID через запятую. `MAX_API_URL` остаётся серверной настройкой и через GitHub не синхронизируется.

Существующий `.env` обязателен. Обновление происходит атомарно через временный файл в том же каталоге, с правами `600` и сохранением владельца и группы. Неизвестные скрипту настройки, комментарии и `DEMO_ENABLED=true` сохраняются. Ошибка проверки останавливает deployment до перезапуска приложения. Последующий откат кода не возвращает предыдущие значения MAX-настроек.

Workflow не генерирует токены, не отключает демонстрационный режим и не выполняет `setup-max.mjs` при каждом push. Настройка кнопки мини-приложения и webhook выполняется отдельно после предоставления необходимых MAX-настроек владельцем.

## Ручной релиз

Из корня клона репозитория, после commit всех изменений:

```bash
revision=$(git rev-parse HEAD)
git archive --format=tar.gz --output="/tmp/banquet-$revision.tar.gz" "$revision"
ssh aboba@mail.lonelycraft.ru "mkdir -p '/srv/banquet/releases/$revision'"
scp "/tmp/banquet-$revision.tar.gz" "aboba@mail.lonelycraft.ru:/srv/banquet/releases/$revision/source.tar.gz"
ssh aboba@mail.lonelycraft.ru "tar -xzf '/srv/banquet/releases/$revision/source.tar.gz' -C '/srv/banquet/releases/$revision' && sudo -n bash '/srv/banquet/releases/$revision/scripts/deploy.sh' '$revision'"
```

SSH должен использовать уже проверенный host key. Архив загружается и распаковывается от `aboba`, а сам deploy-скрипт выполняется через `sudo -n`; каталоги загрузки остаются доступны для следующего релиза. Для чтения состояния контейнера на сервере:

```bash
sudo -n bash <<'SH'
  cd /srv/banquet/current
  export BANQUET_ENV_FILE=/srv/banquet/.env
  export BANQUET_IMAGE=$(cat /srv/banquet/deployed-image)
  docker compose --env-file /srv/banquet/.env ps
  docker compose --env-file /srv/banquet/.env logs --tail=100 app
SH
curl --fail https://mail.lonelycraft.ru/banquet/healthz
```

После изменения runtime-параметров `/srv/banquet/.env` примените конфигурацию командой `docker compose --env-file /srv/banquet/.env up -d --no-build --force-recreate app` внутри такого же `sudo -n bash` блока с экспортом `BANQUET_ENV_FILE` и `BANQUET_IMAGE`. Изменение `VITE_BASE_PATH` требует нового build и повторного релиза.

## Резервные копии и восстановление

```bash
sudo -n bash /srv/banquet/current/scripts/backup.sh
```

Скрипт выполняет SQLite `VACUUM INTO` — согласованную копию активной базы — и `PRAGMA quick_check` результата. Хранятся 10 последних копий. Не копируйте отдельно открытый `.sqlite` снаружи контейнера: актуальные изменения могут находиться в WAL. Копии в том же томе защищают от ошибки релиза, но при отказе диска нужны внешние копии. Их можно выгружать на доверенное хранилище командой `sudo -n docker cp <container-id>:/data/backups/. <каталог-копий>`.

Автоматический откат возвращает код, сохраняя базу. Изменения схемы должны оставаться совместимыми с предыдущим релизом; разрушительные миграции требуют отдельного плана восстановления. Скрипт никогда автоматически не восстанавливает старую базу, потому что это удалило бы заказы, появившиеся после резервного копирования.

Для восстановления выбранной копии остановите приложение, сохраните текущие файлы базы, замените базу проверенной копией и удалите только соответствующие старые WAL/SHM после остановки всех соединений. Сохраните владельца файлов `1000:1000` (пользователь `node`), затем запустите контейнер и проверьте состояние заказа. Не выполняйте `docker compose down -v`: флаг `-v` удаляет постоянный том с данными.

## Проверка первого запуска

Проверьте загрузку `/banquet/`, ответ `/banquet/healthz`, сохранение заказа после перезапуска контейнера и прежнюю доступность веб-интерфейса почты. Для работы внутри MAX потребуются токен бота, настройка мини-приложения на публичный HTTPS URL и ID администраторов ресторана; до этого доступен демонстрационный сценарий.
