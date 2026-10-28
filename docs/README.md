# Документация расширения

- [README](../README.md) — настройка сервера, обновление и запуск тестов.
- [Инструкция пользователю](../client/README.md) — установка, запись и восстановление.
- [API](../client/API-COMPATIBILITY.md) — контракт веб-прокторинга.
- [AGENTS](../AGENTS.md) — правила разработки и сохранности записей.
- [Тесты](../tests/README.md), [mock API](../tests/mocks/README.md),
  [матрица сценариев](test-coverage.md), [результаты проверок](validation.md).
- [Версии](versioning.md), [изменения](../CHANGELOG.md),
  [план обновления](production-upgrade.md).

Рабочий продукт — `client`; отдельного сервера в репозитории нет. Node, Chrome,
Xvfb и ffprobe для тестов устанавливаются в Docker, локально и в CI используется
один Compose-сервис. Внешний backend заменён mock; его contract-тесты проверяют
заглушку, а не развёрнутые web/ML. Настоящий сквозной runner находится в
[web-репозитории](https://github.com/OSLL/proctoring/blob/pre-release/tests/extension/README.md).

Playground содержит исторические эксперименты. Датированные validation-отчёты
сохраняют результаты и ограничения своего прогона. Проверка callback четырёхчасового
лимита не подтверждает многочасовую запись. Версии проектов независимы.
