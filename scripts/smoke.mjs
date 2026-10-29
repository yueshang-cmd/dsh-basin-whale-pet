/**
 * 无浏览器冒烟测试：极简 React 跑通 Pet 首帧渲染 + 「击飞 → 追 → 捡 → 归位」整条动画。
 * 目的：抓 ReferenceError / 死锁 / phase 不复位 / 首帧缺字段，不做像素验证。
 * 运行：node smoke.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout

// ---------------------------------------------------------------- 假时钟 + 假 RAF
let rafQueue = []
let frameTime = 1000
let fakeTimers = []
globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length }
globalThis.cancelAnimationFrame = () => {}
globalThis.performance = { now: () => frameTime }
globalThis.setTimeout = (fn, ms) => { const id = fakeTimers.length + 1; fakeTimers.push({ fn, left: ms || 0, id }); return id }
globalThis.clearTimeout = (id) => { fakeTimers = fakeTimers.filter((x) => x.id !== id) }
globalThis.setInterval = () => 0
globalThis.clearInterval = () => {}

function tickTimers(ms) {
  for (let guard = 0; guard < 8; guard++) {
    let fired = false
    for (const t of fakeTimers.slice()) {
      t.left -= ms
      if (t.left <= 0) { fakeTimers = fakeTimers.filter((x) => x !== t); t.fn(); fired = true }
    }
    if (!fired) return
  }
}

// ---------------------------------------------------------------- 假 DOM
globalThis.window = globalThis
globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
globalThis.addEventListener = () => {}
globalThis.removeEventListener = () => {}
Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
const lsStore = new Map()
globalThis.localStorage = { getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null), setItem: (k, v) => lsStore.set(k, String(v)) }
globalThis.fetch = async () => ({
  ok: true, status: 200,
  json: async () => ({
    ok: true, nowSec: Math.floor(Date.UTC(2026, 9, 28, 17, 36) / 1000),
    dayStartSec: Math.floor(Date.UTC(2026, 9, 28, 16, 0) / 1000),
    segments: [{ hour: 0, peak: false }, { hour: 9, peak: true }, { hour: 12, peak: false }, { hour: 14, peak: true }, { hour: 18, peak: false }],
    peak: false, tier: 'valley', multiplier: 1,
    nextSwitchAt: Math.floor(Date.UTC(2026, 9, 28, 22, 0) / 1000),
    currency: 'CNY', balance: 29.284926, recharge: 28.2, bonus: 1.08,
    balanceSource: 'account', todayUsed: 1.47, todayCredits: 0, error: '', stale: false,
  }),
})
globalThis.AbortController = class { constructor() { this.signal = {} } abort() {} }

// ---------------------------------------------------------------- 极简 React
let hookSlots = []
let hookIndex = 0
let effects = []
const useState = (init) => {
  const i = hookIndex++
  if (!(i in hookSlots)) hookSlots[i] = { value: typeof init === 'function' ? init() : init }
  const s = hookSlots[i]
  return [s.value, (v) => { s.value = typeof v === 'function' ? v(s.value) : v }]
}
const useRef = (init) => { const i = hookIndex++; if (!(i in hookSlots)) hookSlots[i] = { current: init }; return hookSlots[i] }
const useMemo = (fn) => { const i = hookIndex++; if (!(i in hookSlots)) hookSlots[i] = { v: fn() }; return hookSlots[i].v }
const useCallback = (fn) => fn
const useEffect = (fn) => { const i = hookIndex++; if (!(i in hookSlots)) { hookSlots[i] = { ran: 1 }; effects.push(fn) } }
const createElement = (type, props, ...children) => {
  if (typeof type === 'function') return type({ ...(props || {}), children })
  const node = { type, props: props || {}, children: children.flat(Infinity).filter((c) => c != null && c !== false && c !== '') }
  return node
}
const React = { createElement, useState, useRef, useMemo, useCallback, useEffect }

// ---------------------------------------------------------------- 加载 client.js
let registered = null
const slots = {
  inject(key, cb) {
    registered = { key }          // register() 会在 cb() 里同步跑，先建好对象
    cb()
    return () => {}
  },
  register(opts, Comp) { registered.opts = opts; registered.Comp = Comp; return () => {} },
}
const ctx = {
  slots,
  get: (name) => (name === 'locale' ? { getSnapshot: () => ({ active: { id: 'zh-CN' } }) } : undefined),
}
globalThis.__ModuleLoader__ = { load(mod) { this._f = mod.factory } }

const src = fs.readFileSync(path.join(DIR, 'client.js'), 'utf8')
new Function('window', '__ModuleLoader__', src)(globalThis, globalThis.__ModuleLoader__)

const api = globalThis.__ModuleLoader__._f((n) => (n === 'react' ? React : (() => { throw new Error('unexpected require: ' + n) })()))
const errors = []
if (!api || typeof api.apply !== 'function') { console.log('模块没有返回 apply'); process.exit(1) }
if (!Array.isArray(api.inject) || !api.inject.includes('slots')) errors.push('inject 应包含 slots')
api.apply(ctx)
if (!registered || registered.key !== 'shell.overlay') errors.push('没有注册到 shell.overlay')

const render = () => { hookIndex = 0; return registered.Comp() }
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => realSetTimeout(r, 0)) }

let tree = render()
for (const fn of effects) fn()      // 跑 pull() 等 effect
await flush()
tree = render()

// ---------------------------------------------------------------- 首帧检查
let flat = ''
const walk = (n) => {
  if (typeof n === 'string' || typeof n === 'number') { flat += ' ' + n; return }
  if (!n || typeof n !== 'object') return
  flat += ' ' + (n.props && n.props.className || '')
  if (n.props && n.props.d) flat += ' ' + String(n.props.d).slice(0, 12)
  for (const c of n.children || []) walk(c)
  if (n.props && n.props.children) (Array.isArray(n.props.children) ? n.props.children : [n.props.children]).forEach(walk)
}
walk(tree)
for (const m of ['bw-panel', 'bw-stage', 'bw-runner is-idle', 'bw-basin-hit', 'DeepSeek 余额', 'OFF-PEAK', '29.28', 'bw-head-basin']) {
  if (!flat.includes(m)) errors.push('首帧缺少 ' + m)
}
if (/\bNaN\b|undefined|—¥/.test(flat)) errors.push('首帧出现 NaN/undefined 痕迹：' + (flat.match(/.{0,40}(NaN|undefined).{0,40}/) || [''])[0])

// ---------------------------------------------------------------- 击飞 → 归位
function find(node, cls) {
  if (!node || typeof node !== 'object') return null
  if (node.props && String(node.props.className || '').includes(cls)) return node
  const kids = (node.children || []).concat(node.props && node.props.children ? (Array.isArray(node.props.children) ? node.props.children : [node.props.children]) : [])
  for (const c of kids) { const hit = find(c, cls); if (hit) return hit }
  return null
}
const basinBtn = find(tree, 'bw-basin-hit')
if (!basinBtn) errors.push('找不到盆的点击区')
if (basinBtn) {
  basinBtn.props.onClick({ stopPropagation() {}, preventDefault() {}, clientX: 120, clientY: 40 })
  let sawKnocked = false, sawChase = false, sawPickup = false, sawCarry = false, sawHappy = false
  let idle = false
  for (let f = 0; f < 1400 && !idle; f++) {
    frameTime += 16
    const q = rafQueue; rafQueue = []
    for (const cb of q) cb(frameTime)
    tickTimers(16)
    await flush()
    flat = ''
    hookIndex = 0
    walk(registered.Comp())
    if (flat.includes('is-knocked')) sawKnocked = true
    if (flat.includes('is-chase')) sawChase = true
    if (flat.includes('is-pickup')) sawPickup = true
    if (flat.includes('is-carry')) sawCarry = true
    if (flat.includes('is-happy')) sawHappy = true
    idle = flat.includes('bw-runner is-idle') && flat.includes('bw-basin-hit')
  }
  if (!sawKnocked) errors.push('没进入 knocked')
  if (!sawChase) errors.push('没进入 chase（跑过去）')
  if (!sawPickup) errors.push('没进入 pickup（蹲下捡）')
  if (!sawHappy) errors.push('没进入 happy（归位）')
  if (!idle) errors.push('1400 帧后没回到 idle —— 序列可能死锁')
  const busy = hookSlots.find((s) => s && s.current === false && 'busy' in s) // 不可靠，改为行为断言即可
  console.log('phase 走完: knocked=%s chase=%s pickup=%s carry=%s happy=%s idle=%s', sawKnocked, sawChase, sawPickup, sawCarry, sawHappy, idle)
}

// ---------------------------------------------------------------- 点鲸鱼娘
tree = render()
const runnerEl = find(tree, 'bw-runner')
if (runnerEl && runnerEl.props.onClick) {
  runnerEl.props.onClick({ stopPropagation() {} })
  await flush()
  const f2 = (() => { flat = ''; hookIndex = 0; walk(registered.Comp()); return flat })()
  if (!f2.includes('bw-bubble')) errors.push('点鲸鱼娘没有冒吐槽泡')
} else errors.push('鲸鱼娘没有 onClick')

// ---------------------------------------------------------------- 报告
if (errors.length) { console.log('\n问题：\n - ' + errors.join('\n - ')); process.exit(1) }
console.log('smoke passed：首帧渲染（余额/谷时段/条带）· 击飞→追→捡→归位全流程 · 点鲸鱼冒泡')
