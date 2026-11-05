# INTERNAL — как устроено сейчас (0.1.0)

`apply` → `fs.watch(root/role)` → дедуп по `seen` → окно лимита →
`agent.inject(заметка)`. Тулы `mailbox_status` / `mailbox_throttle` —
изменение in-memory-состояния.

## Неизвестные (закрыть до 0.2.0)

1. **Регистрация raw-инструментов.** ЗАКРЫТ 2026-11-05 (этап 0, исходник
   `core/tools/src/index.ts:128–136`, харнесс 0.2.2-alpha.2): без
   `output: {schema, render}` — синхронный TypeError; `defineTool` НЕ
   обязателен, inline-`output` в raw-определении достаточно (схемы —
   подмножество JSON Schema, см. docs/РАЗРАБОТКА.md). Опечатка-прецедент
   Офлайн-подтверждение формы — прогон dsh-wave-gate-tool 0.1.1 через
   настоящие валидаторы core/tools; живое подтверждение реестром — за
   рестартом DSH (см. его INTERNAL.md).
2. **Форма `agent.inject`.** ЗАКРЫТ (исходник `dsh-agent/src/runtime-types.ts`):
   `inject(message: UserMessage)` — объект, НЕ строка; без пробуждения.
   `followup(message: UserMessage)` — будит; `steer`, `send(message,
   target, wakeup)` — рядом там же. 0.1.0 передаёт — проверить на этапе 3.
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
