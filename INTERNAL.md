# INTERNAL — как устроено сейчас (0.1.0)

`apply` → `fs.watch(root/role)` → дедуп по `seen` → окно лимита →
`agent.inject(заметка)`. Тулы `mailbox_status` / `mailbox_throttle` —
изменение in-memory-состояния.

## Неизвестные (закрыть до 0.2.0)

1. **Регистрация raw-инструментов.** Принимает ли `tools.register`
   определение без `output`/`defineTool`. Проверить: установка + `Tool.listTools`;
   при отказе — использовать `defineTool` из `@deepseek-ai/dsh-tools`
   (зависимость от резолва пакета из установки dsh — проверить).
2. **Форма `agent.inject`.** Строка или объект сообщения — смотреть
   `dsh-agent` (`lib/types/**`, JSDoc) и practices.md (`agent/inbox/spliced`).
3. **Адресация цели.** `targetSession` — id из GUI; добавить подсказку в
   README, где его взять; вариант доводки — `/почта привязать` как
   slash-команда, привязывающая текущую сессию.
4. **Постоянство паузы.** Перевести `enabled`/`limitPerHour` в volatile-поля
   конфига через `configEditor` (host-plugin.md), чтобы пауза переживала
   рестарт.
5. **wake-режим.** `agent.followup()` — только по явному `wake: true`.

## Как проверить заготовку

Установить (enabled:false) → положить тестовое письмо в копия-директорию
(не в боевой Mailbox!) с `root` на копию → `mailbox_status` → доставлено 1 →
`mailbox_throttle pause` → ещё письмо → доставлено 0, lastSkip видна.
