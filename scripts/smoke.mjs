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
// 记录本轮渲染里出现的 ref，渲染后统一挂上假 DOM 元素。
// 不挂 ref 的话 flyRef.current 永远是 null，setFly 会提前 return，
// 「盆飞了多远」这条数学就完全没被跑到 —— 那正是本次要验证的东西。
let refSlots = []
const flyRefs = new Map()          // className → ref，按类名精确取，避免与 runner 的 translate3d 混淆
const createElement = (type, props, ...children) => {
  if (typeof type === 'function') return type({ ...(props || {}), children })
  const node = { type, props: props || {}, children: children.flat(Infinity).filter((c) => c != null && c !== false && c !== '') }
  if (node.props.ref) {
    refSlots.push(node.props.ref)
    if (typeof node.props.className === 'string') flyRefs.set(node.props.className, node.props.ref)
  }
  return node
}
const React = { createElement, useState, useRef, useMemo, useCallback, useEffect }

/** 给本轮出现的 ref 挂上假元素；ref 对象由 useRef 复用，挂一次就一直在 */
function mountRefs() {
  for (const ref of refSlots) {
    if (!ref || typeof ref !== 'object' || ref.current) continue
    ref.current = { style: {}, dataset: {}, getBoundingClientRect: () => STAGE_RECT, classList: { add() {}, remove() {} } }
  }
}

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

// client.js 现在会 require('react-dom') 取 createPortal，并读 window.innerWidth/Height 算飞行区间。
// Node 里这两个都没有：innerWidth 缺省会变成 Math.max(320, undefined) = NaN，
// 整个飞行数学就废了 —— 所以必须在注入前给准。
globalThis.innerWidth = Number(process.env.SMOKE_VW || 1600)
globalThis.innerHeight = Number(process.env.SMOKE_VH || 900)
const reactDomStub = { createPortal: (node) => node }   // 直接返回节点，好让 walk 能找到它

// 舞台在视口里的量出来的位置（真实浏览器由 getBoundingClientRect 给）。
// 宽 300 = STAGE_W ⇒ 缩放 sc=1，测试里的像素可以直接当舞台坐标读。
const STAGE_RECT = {
  left: Number(process.env.SMOKE_STAGE_X || 24),
  top: Number(process.env.SMOKE_STAGE_Y || 500),
  width: 300, height: 300,
}

const src = fs.readFileSync(path.join(DIR, 'client.js'), 'utf8')
new Function('window', '__ModuleLoader__', src)(globalThis, globalThis.__ModuleLoader__)

const api = globalThis.__ModuleLoader__._f((n) => {
  if (n === 'react') return React
  if (n === 'react-dom') return reactDomStub
  throw new Error('unexpected require: ' + n)
})
const errors = []
if (!api || typeof api.apply !== 'function') { console.log('模块没有返回 apply'); process.exit(1) }
if (!Array.isArray(api.inject) || !api.inject.includes('slots')) errors.push('inject 应包含 slots')
api.apply(ctx)
if (!registered || registered.key !== 'shell.overlay') errors.push('没有注册到 shell.overlay')

const render = () => { hookIndex = 0; refSlots = []; const tr = registered.Comp(); mountRefs(); return tr }
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
  // 头上盆的视口锚点：HEAD.x = WHALE_X(40) + 110 = 150；舞台量出来宽 300 ⇒ sc = 1
  const HEAD_X = STAGE_RECT.left + 150
  // setFly 写的是 translate3d(x - FLY_W/2, y - FLY_H/2, 0)，所以反推盆中心要加回半宽高
  const FLY_HALF_W = 145 / 2, FLY_HALF_H = 94 / 2
  const flyRef = flyRefs.get('bw-fly')
  if (!flyRef) errors.push('测试没抓到 bw-fly 的 ref，无法量飞行距离')
  const flyX = () => {
    const st = flyRef && flyRef.current && flyRef.current.style
    const tr = st && st.transform
    if (typeof tr !== 'string' || !tr.startsWith('translate3d(')) return null
    const m = tr.match(/translate3d\(([-\d.]+)px,\s*([-\d.]+)px/)
    if (!m) return null
    return { x: Number(m[1]) + FLY_HALF_W, y: Number(m[2]) + FLY_HALF_H }
  }

  basinBtn.props.onClick({ stopPropagation() {}, preventDefault() {}, clientX: STAGE_RECT.left + 200, clientY: STAGE_RECT.top + 50 })
  let sawKnocked = false, sawChase = false, sawPickup = false, sawCarry = false, sawHappy = false
  let idle = false
  // 分阶段量：只有 knocked（被击飞）算「击飞范围」。
  // 把 carry（抱盆走回来）也算进路径长度是作弊 —— 那不是被击飞的距离。
  let flightLen = 0, flightMax = 0, prevX = null, samples = 0
  let allLen = 0, prevAll = null
  let phaseNow = ''
  for (let f = 0; f < 2600 && !idle; f++) {
    frameTime += 16
    const q = rafQueue; rafQueue = []
    for (const cb of q) cb(frameTime)
    tickTimers(16)
    await flush()
    const p = flyX()
    if (p) {
      if (prevAll !== null) allLen += Math.abs(p.x - prevAll)
      prevAll = p.x
    }
    flat = ''
    walk(render())
    const mm = flat.match(/bw-runner is-([a-z]+)/)
    phaseNow = mm ? mm[1] : phaseNow
    if (p && phaseNow === 'knocked') {
      samples++
      if (prevX !== null) flightLen += Math.abs(p.x - prevX)
      prevX = p.x
      flightMax = Math.max(flightMax, Math.abs(p.x - HEAD_X))
    }
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
  if (!idle) errors.push('2600 帧后没回到 idle —— 序列可能死锁')
  console.log('phase 走完: knocked=%s chase=%s pickup=%s carry=%s happy=%s idle=%s', sawKnocked, sawChase, sawPickup, sawCarry, sawHappy, idle)
  console.log('击飞阶段(knocked): %d 帧  路径=%dpx  离模型最远=%dpx', samples, Math.round(flightLen), Math.round(flightMax))
  console.log('全程含归位: 路径=%dpx   视口 %dpx 宽', Math.round(allLen), globalThis.innerWidth)

  // 需求「离模型 1000px 以上」。视口宽度决定它能不能**直线**达到：
  // 盆不能穿墙，所以直线天花板 = 视口宽 - WALL_PAD(24) - 舞台左(24) - HEAD 偏移(150)。
  // 窄窗口下靠撞墙反弹把**路径长度**撑过 1000px —— 盆确实跑了 1000px 以上，只是没直线那么远。
  const ceiling = globalThis.innerWidth - 24 - STAGE_RECT.left - 150
  if (samples < 20) errors.push('knocked 阶段几乎没有位移（' + samples + ' 帧），setFly 可能没被跑到')
  if (ceiling >= 1000) {
    if (flightMax < 1000) errors.push(`视口够宽（直线可达 ${Math.round(ceiling)}px）却只飞出 ${Math.round(flightMax)}px`)
    else console.log(`  ✓ 直线距离达标：${Math.round(flightMax)}px ≥ 1000（天花板 ${Math.round(ceiling)}px）`)
  } else {
    if (flightLen < 1000) errors.push(`窄视口下直线天花板只有 ${Math.round(ceiling)}px，撞墙折叠后路径仍只有 ${Math.round(flightLen)}px < 1000`)
    else console.log(`  ✓ 窄视口（直线天花板 ${Math.round(ceiling)}px）：靠撞墙反弹，路径 ${Math.round(flightLen)}px ≥ 1000`)
  }
  if (flightMax > globalThis.innerWidth) errors.push('直线距离超过视口宽度，坐标算错：' + Math.round(flightMax))
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
