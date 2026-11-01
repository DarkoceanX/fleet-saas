# Структура проекта

Архив содержит документацию, настройки, навыки и автономный пример. В нём нет
пустых директорий, выдаваемых за реализованные приложения.

```text
fleet-saas-hybrid-codex-starter/
  AGENTS.md
  README.md
  .codex/config.toml
  .agents/skills/{fleet-plan,fleet-api,fleet-ui,fleet-data,fleet-costing,fleet-release}/SKILL.md
  .github/workflows/starter-checks.yml
  .github/pull_request_template.md
  docs/
  templates/
  examples/trip-cost.json
  scripts/{calculate_trip,check_starter,bootstrap}.py
  tests/test_calculate_trip.py
  .env.example
  .gitignore
  .gitattributes
  MANIFEST.sha256
```

При принятии предложенного TypeScript-стека создать:

```text
apps/web/                 Next.js: страницы и компоненты
apps/api/                 NestJS: модули и HTTP-контроллеры
apps/worker/              Только когда появятся фоновые задачи
packages/contracts/       Схемы запросов и ответов
packages/domain/          Чистая логика, в том числе расчёт рейса
database/migrations/      Миграции с историей
database/fixtures/        Синтетические тестовые данные
tests/integration/        API + настоящая тестовая PostgreSQL
tests/e2e/                Критичные пользовательские сценарии
infra/                    Конфигурация выбранного размещения
```

Первый implementation PR фиксирует версии Node/менеджера пакетов и lockfile,
добавляет реальные команды сборки и проверок. Версии выбирать по совместимости
на момент реализации; starter не обещает готовый npm install или npm run dev.
Не дублировать вычисление денег в браузере и API. Доменный пакет — единственный
авторитетный расчёт; Python-пример служит независимым набором эталонов.
