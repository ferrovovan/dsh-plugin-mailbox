/**
 * «Почта» — доставка писем Mailbox/ (протокол: Mailbox/README.md) в
 * сессию-получателя.
 *
 * Статус 0.1.0: заготовка. Слежение, лимиты и инструменты регулирования
 * — рабочий контур; форма inject-аргумента и адресация цели — неизвестные
 * (INTERNAL.md).
 *
 * Контракт хозяина (2026-11-05): у получателя право снизить порог,
 * поставить паузу и полностью отключить вкидывание — инструментами
 * mailbox_throttle / mailbox_status и конфигом строки.
 */
import fs from 'node:fs'
import path from 'node:path'

export const name = 'dsh-mailbox'
export const inject = ['tools', 'agents']

const FIELDS = new Set(['От', 'Кому', 'Тема', 'Статус', 'Нужно', 'Срок'])

function parseLetter(text) {
  const fields = {}
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*\*{0,2}([А-ЯЁA-Za-z][-\wА-ЯЁ]*)\*{0,2}:\s*(.*)$/)
    if (m && FIELDS.has(m[1])) fields[m[1]] = m[2].trim()
  }
  return fields
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
      // НЕИЗВЕСТНЫЙ №2 (INTERNAL.md): точная форма аргумента agent.inject.
      agent.inject(note)
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

  // Инструменты: право получателя над собственной приёмкой.
  const register = (definition) => {
    try { ctx.effect(() => ctx.tools.register(definition), `mailbox.tool(${definition.name})`) }
    catch (error) { skip(`тул ${definition.name} не зарегистрирован (неизвестный №3): ${error?.message}`) }
  }

  register({
    name: 'mailbox_status',
    description: 'Состояние приёмки почты: вкл/выкл, почасовой порог, доставлено в этом часе, причина последнего пропуска.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      return { enabled: state.enabled, limitPerHour: state.limitPerHour, deliveredThisHour: state.delivered, lastSkip: state.lastSkip }
    },
  })

  register({
    name: 'mailbox_throttle',
    description: 'Регулировка приёмки почты получателя: pause — пауза (письма не вкидываются), resume — возобновить, limit — почасовой порог (0 — без лимита). Влияет только на этот ящик.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['pause', 'resume', 'limit'], description: 'Что сделать с приёмкой.' },
        limit: { type: 'integer', description: 'Для action=limit: писем в час, 0 — без лимита.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(args) {
      if (args.action === 'pause') state.enabled = false
      if (args.action === 'resume') state.enabled = true
      if (args.action === 'limit') state.limitPerHour = Math.max(0, Number(args.limit ?? 6))
      return { enabled: state.enabled, limitPerHour: state.limitPerHour }
    },
  })
}
