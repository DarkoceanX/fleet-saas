# Проверка расходов, доходов и результата периода — 24.10.2026

Проверялся source-only staging в отдельной папке task-2/fleet-period-stage.
Рабочие .env, PostgreSQL/SQLite, серверы и пользовательские записи не использовались.
Все fixtures синтетические. Старый MVP не изменялся и не запускался.

| Проверка | Фактический результат |
|---|---|
| npm run typecheck | PASS: shared/API/web/tools, включая браузерную fixture |
| npm run lint | PASS, без исключения новых файлов |
| npm test | 30 passed, 0 failed, 0 skipped (15 прежних + 10 период + 5 доходы) |
| npm run test:integration | 63 passed, 0 failed, 0 skipped; 59 subtests + 4 parent tests |
| npm run test:period:browser | 18 passed, реальный headless Chrome и React DOM, mock transport |
| npm run build | PASS shared/Nest/Next webpack; маршруты / и /period |
| db:migrate два раза на каждом подэтапе | PASS на отдельной fleet_period_test: 001–003, затем 004; повторы без эффектов |
| python scripts/check_starter.py | PASS: структура, 6 skills, TOML и локальные ссылки |
| python -m unittest discover -s tests -v | 12 passed — Python-калькулятор starter, не старый MVP |

Интеграция: новый PostgreSQL 17.11 на 127.0.0.1:56438, отдельный кластер внутри
task-2/fleet-period-postgres, база fleet_period_test, случайная схема каждого набора.
После проверок **этот** тестовый кластер остановлен. Рабочий PostgreSQL не трогали.
Старые 34 интеграционных сценария выполнены уже с 003/004; ещё 14 проверяют расходный модуль,
в том числе upgrade с существующим фактическим расходом и неизменность его полей.
Ещё 11 проверяют доходы: сохранность legacy planned revenue без импорта, единый
источник, outside-trip, source_ref uniqueness, unknown/zero/partial, отдельный
результат, gross cost invariance, stale/concurrent review, date/edit/void/reassignment,
все endpoints × forbidden roles и чужие tenant IDs, composite FK, decimal validation.

Проверены 50000/1000/40 → 50/1250; add10000 → 60/1500; edit20000 → 70/1750;
delete → baseline. Missing boundaries сохраняют расходы, не выдумывают ставки;
нулевые/неизвестные счётчики, точность, tiny rate, неинтерполируемые границы,
own/rent, ручное признание, tenant/roles/FK, версии и конкурентный stale review.
Проверены уникальность source, замена ручного дубля ссылкой, повтор после timeout,
смена машины, перенос даты источника в другой период и void. План не попадает в факт.

Browser 18 сценариев: прежние 12 — baseline; cost add/edit/cancel/delete/add; reading add/edit
с null и 0/cancel/delete-add; lost-response retry с прежним idempotency key;
смена периода закрывает редактор. Ещё 6 — неизвестный доход, add без автоматической
даты и без изменения gross cost, edit с отдельным результатом, cancel без stale ID,
void с историей и unknown, новое add после void и lost-response retry ровно один раз.
Это реальные DOM-события и состояние React,
но не end-to-end с сервером, не визуальная/mobile-приёмка.

Первичные попытки внутри sandbox выявили ограничения среды: TCP EACCES/10013 к
тестовому PostgreSQL, невозможность запуска Chrome и mkdir Next `.next`. Они не
считались успешными. Узкие повторные проверки вне sandbox только на staging и
синтетических ресурсах завершились результатами таблицы. Lint выявлял неиспользованный
импорт и throw в finally тестового runner; исправлены, затем lint прошёл.

Не выполнены: рабочая миграция/перезапуск, backup/restore drill, ручной smoke реального
UI+API, mobile/layout, нагрузка больших периодов. Доходы и отдельный финансовый
результат реализованы и проверены автоматически; production readiness не заявляется.
Контракты и ограничения: [VEHICLE_PERIOD](VEHICLE_PERIOD.md), [RECOGNIZED_INCOME](RECOGNIZED_INCOME.md).
