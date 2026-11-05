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

## Офлайн-прогон 0.1.1 (замер 2026-11-05, .лаборатория/этап3/mailbox-test.mjs)

Живой `fs.watch` + фейковый agent (строгая проверка формы UserMessage) +
настоящие валидаторы core/tools для output/parameters обоих тулов:
пауза → 0 доставок + lastSkip с причиной; resume → доставка («Тема»/«От»
расшиты из боевого формата письма); `Статус: закрыто` → не доставлено;
`limitPerHour: 2` → 3-е письмо отклонено с причиной в lastSkip;
`mailbox_throttle pause` → persisted-строка (configEditor офлайн
недоступен — честный отказ). Живые пункты (боевой Mailbox копией,
configEditor на реальной строке) — после рестарта.

## Живая приёмка 2026-11-05 (после рестарта, замер)

- `Tool.listTools`: `mailbox_status`, `mailbox_throttle` присутствуют —
  контракт output{schema,render} подтверждён живым реестром.
- Вызов `mailbox_status` → «приёмка ПАУЗА, лимит 6/час, доставлено 0»
  (рубилен false соблюдается).
- Вызов `mailbox_throttle limit:6` вскрыл живой контракт: вывод валидируется
  по output.schema, лишние поля — отказ вызова. Исправлено (0.1.2),
  офлайн-тест усилен validateJsonSchemaValue на значениях.
