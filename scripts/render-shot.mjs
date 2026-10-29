/**
 * 出图：用 mini-React 渲染 Pet 的 DOM 树 → 序列化成 HTML → 无头 Edge 截图。
 * 目的是肉眼验收美术（盆在不在头上、女仆鲸鱼像不像、面板排布）与动画中间态。
 * 运行：node render-shot.mjs [phase]  （phase: idle|knocked|chase|pickup|carry|happy）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PHASE = process.argv[2] || 'idle'

// ---------------------------------------------------------------- 假环境（同 smoke.mjs）
const realSetTimeout = globalThis.setTimeout
globalThis.requestAnimationFrame = () => 0
globalThis.cancelAnimationFrame = () => {}
globalThis.performance = { now: () => 0 }
globalThis.setTimeout = (fn, ms) => { if (ms <= 60) realSetTimeout(fn, 0); return 0 }
globalThis.clearTimeout = () => {}
globalThis.setInterval = () => 0
globalThis.clearInterval = () => {}
globalThis.window = globalThis
globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
globalThis.addEventListener = () => {}
globalThis.removeEventListener = () => {}
Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
const lsStore = new Map()
globalThis.localStorage = { getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null), setItem: (k, v) => lsStore.set(k, String(v)) }
// 一个峰时段 + 有余额的样本，方便看两种配色
globalThis.fetch = async () => ({
  ok: true, status: 200,
  json: async () => ({
    ok: true, nowSec: Math.floor(Date.UTC(2026, 10, 3, 2, 0) / 1000),
    dayStartSec: Math.floor(Date.UTC(2026, 10, 3, 16, 0) / 1000),
    segments: [{ hour: 0, peak: false }, { hour: 9, peak: true }, { hour: 12, peak: false }, { hour: 14, peak: true }, { hour: 18, peak: false }],
    peak: PHASE === 'idle' ? true : true, tier: 'peak', multiplier: 2,
    nextSwitchAt: Math.floor(Date.UTC(2026, 10, 3, 4, 0) / 1000),
    currency: 'CNY', balance: 29.284926, recharge: 28.2, bonus: 1.08,
    balanceSource: 'account', todayUsed: 1.47, todayCredits: 0, error: '', stale: false,
  }),
})
globalThis.AbortController = class { constructor() { this.signal = {} } abort() {} }

// ---------------------------------------------------------------- mini React
let hookSlots = [], hookIndex = 0, effects = []
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
  return { type, props: props || {}, children: children.flat(Infinity).filter((c) => c != null && c !== false && c !== '') }
}
const React = { createElement, useState, useRef, useMemo, useCallback, useEffect }

let registered = null
const slots = {
  inject(key, cb) { registered = { key }; cb(); return () => {} },
  register(opts, Comp) { registered.opts = opts; registered.Comp = Comp; return () => {} },
}
const ctx = { slots, get: () => ({ getSnapshot: () => ({ active: { id: 'zh-CN' } }) }) }

globalThis.__ModuleLoader__ = { load(mod) { this._f = mod.factory } }
new Function('window', '__ModuleLoader__', fs.readFileSync(path.join(DIR, 'client.js'), 'utf8'))(globalThis, globalThis.__ModuleLoader__)
const api = globalThis.__ModuleLoader__._f((n) => React)
api.apply(ctx)

// 渲染：先跑 effect 触发 fetch（假数据），等微任务落进 state，再钉住 phase 重渲染
const render = () => { hookIndex = 0; return registered.Comp() }
render()
for (const fn of effects) fn()
const settle = () => new Promise((r) => realSetTimeout(r, 60))
await settle()
const phaseSlot = hookSlots.find((s) => s && s.value === 'idle')
if (phaseSlot && PHASE !== 'idle') phaseSlot.value = PHASE
let tree = render()

// ---------------------------------------------------------------- 序列化
const SVG_ATTR = {
  strokeWidth: 'stroke-width', strokeLinejoin: 'stroke-linejoin', strokeLinecap: 'stroke-linecap',
  strokeDasharray: 'stroke-dasharray', fillOpacity: 'fill-opacity', stopColor: 'stop-color',
  stopOpacity: 'stop-opacity', fillRule: 'fill-rule', clipRule: 'clip-rule',
}
const SKIP = new Set(['children', 'onClick', 'onPointerDown', 'onPointerUp', 'onPointerMove', 'onPointerCancel', 'key', 'ref', 'dangerouslySetInnerHTML'])
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const styleText = (st) => Object.entries(st || {}).map(([k, v]) => {
  const prop = k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
  return prop + ':' + v
}).join(';')

function serialize(node) {
  if (typeof node === 'string' || typeof node === 'number') return esc(node)
  if (!node || typeof node !== 'object') return ''
  const { type, props = {} } = node
  const attrs = []
  for (const [k, v] of Object.entries(props)) {
    if (SKIP.has(k) || v == null || v === false) continue
    if (k === 'className') { attrs.push('class="' + esc(v) + '"'); continue }
    if (k === 'style') { if (typeof v === 'object') { const s = styleText(v); if (s) attrs.push('style="' + esc(s) + '"') } continue }
    if (k === 'value' || k === 'checked') continue
    const name = SVG_ATTR[k] || k
    attrs.push(name + '="' + esc(v === true ? name : v) + '"')
  }
  const inner = (node.children || []).map(serialize).join('')
  if (!node.children || !node.children.length) return '<' + type + (attrs.length ? ' ' + attrs.join(' ') : '') + '/>'
  return '<' + type + (attrs.length ? ' ' + attrs.join(' ') : '') + '>' + inner + '</' + type + '>'
}

const html = '<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>'
  + 'html,body{margin:0;height:100%;background:#101722;}'
  + 'body{display:flex;align-items:flex-end;justify-content:flex-end;font-family:"Microsoft YaHei",system-ui,sans-serif;}'
  + ':root{--dsw-alias-label-primary:#1b2637;--dsw-alias-label-secondary:#5b6b82;--dsw-alias-bg-overlay:#fbfdff;'
  + '--dsw-alias-bg-layer-2:#eef3fa;--dsw-alias-border-l1:#d5dfeb;--dsw-alias-border-l2:#b9c7d8;'
  + '--dsw-alias-brand-primary:#4a6cf7;--dsw-alias-state-success-primary:#2fa24c;--dsw-alias-state-error-primary:#e0433f;}'
  + '</style></head><body>' + serialize(tree) + '</body></html>'

const outDir = path.resolve(DIR, '..', 'basin-preview')
fs.mkdirSync(outDir, { recursive: true })
const out = path.join(outDir, 'preview-' + PHASE + '.html')
fs.writeFileSync(out, html, 'utf8')
console.log('wrote', out, html.length, 'bytes; phase =', PHASE)
