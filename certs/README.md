# Сертификат для MAX API

`russian-trusted-root-ca.pem` — публичный корневой сертификат Russian Trusted Root CA, полученный 19 сентября 2026 года по проверенному HTTPS с [сервера Госуслуг](https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt). Это сертификат удостоверяющего центра, не приватный ключ.

SHA-256 сертификата: `D26D2D0231B7C39F92CC738512BA54103519E4405D68B5BD703E9788CA8ECF31`.

Срок действия: 1 марта 2022 — 27 февраля 2032. MAX отдаёт промежуточный сертификат Russian Trusted Sub CA (2024), поэтому дополнительно хранить его не нужно.

Docker задаёт `NODE_EXTRA_CA_CERTS=/app/certs/russian-trusted-root-ca.pem` для Node.js процесса приложения и ручной настройки бота. Системное хранилище сервера не меняется. Для локального скрипта: `NODE_EXTRA_CA_CERTS=certs/russian-trusted-root-ca.pem node --env-file=.env scripts/setup-max.mjs`.

Источники: [история API MAX](https://dev.max.ru/docs-api/changelog-api), [официальная инструкция RuStore со ссылками на сертификаты](https://www.rustore.ru/help/developers/monetization/payment-callback/Preparing-the-server-for-RuStore%20API). Отпечаток выше вычислен из скачанного сертификата.
