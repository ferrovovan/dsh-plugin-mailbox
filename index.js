/**
 * «Почта» — доставка писем Mailbox/ (протокол: Mailbox/README.md) в
 * сессию-получателя.
 *
 * Статус 0.1.1: контракт регистрации тулов — как требует харнесс
 * 0.2.2-alpha.2 (output{schema,render}, см. docs/РАЗРАБОТКА.md);
 * agent.inject получает полноценный UserMessage (исходник dsh-agent
 * runtime-types + createUserMessage из dsh-llm: {id uuid, role:'user',
 * content, source:{kind}} — прецедент cordis-host-runner index.ts:1169).
 *
 * Контракт хозяина (2026-11-05): у получателя право снизить порог,
 * поставить паузу и полностью отключить вкидывание — инструментами
 * mailbox_throttle / mailbox_status и конфигом строки.
 */
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const name = 'dsh-mailbox'
export const inject = ['tools', 'agents']

const FIELDS = new Set(['От', 'Кому', 'Тема', 'Статус', 'Нужно', 'Срок'])

function parseLetter(text) {
  const fields = {}
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*\*{0,2}([А-ЯЁA-Za-z][-\wА-ЯЁа-яё]*)\*{0,2}:\s*(.*)$/)
    if (m && FIELDS.has(m[1])) fields[m[1]] = m[2].trim()
  }
  return fields
}

const STATUS_SCHEMA = {
  type: 'object',
  properties: {
    enabled: { type: 'boolean', description: 'Приёмка включена.' },
    limitPerHour: { type: 'integer', description: 'Порог писем в час; 0 — без лимита.' },
    deliveredThisHour: { type: 'integer', description: 'Доставлено в текущем окне.' },
    lastSkip: {
      oneOf: [
        { type: 'null' },
        {
          type: 'object',
          properties: { ts: { type: 'string' }, reason: { type: 'string' } },
          required: ['ts', 'reason'],
          additionalProperties: false,
        },
      ],
      description: 'Причина последнего пропуска (null — пропусков не было).',
    },
  },
  required: ['enabled', 'limitPerHour', 'deliveredThisHour', 'lastSkip'],
  additionalProperties: false,
}

function renderStatus(_args, v) {
  const skip = v.lastSkip ? ` | последний пропуск: ${v.lastSkip.reason}` : ''
  return [{ type: 'text', text: `mailbox: приёмка ${v.enabled ? 'ВКЛ' : 'ПАУЗА'}, лимит ${v.limitPerHour || 'нет'}/час, доставлено ${v.deliveredThisHour}${skip}` }]
}

export function apply(ctx, config = {}) {
  const root = config.root
  if (typeof root !== 'string' || root === '') {
    console.warn('[mailbox] config.root не задан — плагин неактивен')
    return
  }
  const role = config.role || 'Coordinator'
  const inbox = path.join(root, role)
  const state = {
    enabled: config.enabled === true, // по умолчанию ВЫКЛ
    limitPerHour: Number.isFinite(Number(config.limitPerHour)) ? Math.max(0, Number(config.limitPerHour)) : 6,
    windowStart: Date.now(),
    delivered: 0,
    seen: new Set(),
    lastSkip: null,
  }
  const skip = (reason) => {
    state.lastSkip = { ts: new Date().toISOString(), reason }
    console.warn('[mailbox]', reason)
  }

  // Постоянство паузы/лимита (этап 3 №3): пробуем записать в конфиг строки
  // через configEditor. Поле без схемы не объявлено .volatile() — обычный
  // путь: запись в конфиг-слой профиля, плагин перезапустится с новым
  // значением (документировано в INTERNAL). Отказ — честная строка в
  // ответе тула, а не молчаливая потеря (SOUL №4).
  const persist = (patch) => {
    try {
      const editor = ctx.get ? ctx.get('configEditor') : undefined
      if (!editor || !ctx.fiber?.entry) return 'не сохранено в конфиг (нет configEditor/строки) — действует до перезапуска'
      editor.edit(ctx.fiber.entry, (current) => ({ ...(current ?? {}), ...patch }))
      return 'сохранено в конфиг строки'
    } catch (error) {
      return `не сохранено в конфиг: ${error?.message ?? error} — действует до перезапуска`
    }
  }

  const deliver = (file) => {
    if (!state.enabled) return skip('приёмка выключена (пауза) — письмо не доставлено')
    if (state.limitPerHour > 0) {
      const now = Date.now()
      if (now - state.windowStart > 3_600_000) { state.windowStart = now; state.delivered = 0 }
      if (state.delivered >= state.limitPerHour) return skip(`почасовой лимит ${state.limitPerHour} исчерпан — получатель снижает шум`)
    }
    let text
    try { text = fs.readFileSync(file, 'utf8') } catch (error) { return skip(`письмо не читается: ${error?.message}`) }
    const f = parseLetter(text)
    if (/закрыто|отклонено/i.test(f['Статус'] ?? '')) return
    const agent = config.targetSession ? ctx.agents.get(config.targetSession) : undefined
    if (!agent) return skip('targetSession не задан или сессии нет — доставка пропущена')
    const note = `[Почта/${role}] ${f['Тема'] ?? path.basename(file)} (от ${f['От'] ?? '?'}), файл: ${file}`
    try {
      // UserMessage: форма по dsh-llm createUserMessage (id=uuid, role,
      // content-блоки, source.kind продюсера — merge-extensible).
      agent.inject({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: note }],
        source: { kind: 'dsh-mailbox' },
      })
      state.delivered += 1
    } catch (error) {
      skip(`inject не удался: ${error?.message}`)
    }
  }

  // Досматриваем только новые письма: содержимое на момент старта
  // считается прочитанным (не поднимать архив).
  try { for (const f of fs.readdirSync(inbox)) if (f.endsWith('.md')) state.seen.add(f) }
  catch (error) { skip(`ящик не виден (${inbox}): ${error?.message}`) }

  ctx.effect(() => {
    let watcher
    try {
      watcher = fs.watch(inbox, { persistent: false }, (_event, fname) => {
        if (!fname || !fname.endsWith('.md') || state.seen.has(fname)) return
        state.seen.add(fname)
        setTimeout(() => deliver(path.join(inbox, fname)), 500).unref?.()
      })
    } catch (error) { skip(`слежение не поднялось: ${error?.message}`) }
    return () => { try { watcher?.close() } catch { /* уже закрыт */ } }
  }, 'mailbox.watch')

  const snapshot = () => ({
    enabled: state.enabled,
    limitPerHour: state.limitPerHour,
    deliveredThisHour: state.delivered,
    lastSkip: state.lastSkip,
  })

  // Инструменты: право получателя над собственной приёмкой.
  // Без try/catch: отказ регистрации — громкий (SOUL семьи №4).
  const register = (definition) => ctx.effect(() => ctx.tools.register(definition), `mailbox.tool(${definition.name})`)

  register({
    name: 'mailbox_status',
    description: 'Состояние приёмки почты: вкл/выкл, почасовой порог, доставлено в этом часе, причина последнего пропуска.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: STATUS_SCHEMA, render: renderStatus },
    async execute() {
      return snapshot()
    },
  })

  register({
    name: 'mailbox_throttle',
    description: 'Регулировка приёмки почты получателя: pause — пауза (письма не вкидываются), resume — возобновить, limit — почасовой порог (0 — без лимита). Влияет только на этот ящик; пауза/лимит пытаются сохраниться в конфиг строки.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['pause', 'resume', 'limit'], description: 'Что сделать с приёмкой.' },
        limit: { type: 'integer', description: 'Для action=limit: писем в час, 0 — без лимита.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          limitPerHour: { type: 'integer' },
          persisted: { type: 'string', description: 'Куда попала настройка: сохранено/не сохранено и почему.' },
        },
        required: ['enabled', 'limitPerHour', 'persisted'],
        additionalProperties: false,
      },
      render: (_args, v) => [{ type: 'text', text: `mailbox: приёмка ${v.enabled ? 'ВКЛ' : 'ПАУЗА'}, лимит ${v.limitPerHour || 'нет'}/час — ${v.persisted}` }],
    },
    async execute(args) {
      if (args.action === 'pause') state.enabled = false
      if (args.action === 'resume') state.enabled = true
      if (args.action === 'limit') state.limitPerHour = Math.max(0, Number(args.limit ?? 6))
      return { ...snapshot(), persisted: persist({ enabled: state.enabled, limitPerHour: state.limitPerHour }) }
    },
  })
}
