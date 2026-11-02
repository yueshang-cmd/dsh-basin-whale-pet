// 结构断言：头上盆必须是 .bw-body 的**后代**（否则动画时仍会穿模）。
// 只测「源码里看起来对了」不够 —— 要测渲染出来的树。
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// 复用 smoke.mjs 的迷你 React：直接渲染 Whale 并检查祖先链
const src = fs.readFileSync('D:/新建文件夹/dsh-basin-whale-pet/client.js', 'utf8')

// 取出 Whale 函数体与 basinShapes/HeadBasin，在同样的小环境里跑
let hookIndex = 0
const useRef = (i) => ({ current: i })
const React = {
  createElement: (type, props, ...children) => {
    if (typeof type === 'function') return type({ ...(props || {}), children })
    return { type, props: props || {}, children: children.flat(Infinity).filter((c) => c != null && c !== false && c !== '') }
  },
  useState: (v) => [v, () => {}], useRef, useMemo: (f) => f(), useCallback: (f) => f, useEffect: () => {},
}
globalThis.window = globalThis
globalThis.innerWidth = 1600; globalThis.innerHeight = 900
globalThis.localStorage = { getItem: () => null, setItem: () => {} }
globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) })
globalThis.AbortController = class { constructor() { this.signal = {} } abort() {} }
globalThis.__ModuleLoader__ = { load(m) { this._f = m.factory } }
new Function('window', '__ModuleLoader__', src)(globalThis, globalThis.__ModuleLoader__)
const api = globalThis.__ModuleLoader__._f((n) => { if (n === 'react') return React; if (n === 'react-dom') return { createPortal: (x) => x }; throw new Error(n) })
const slots = { inject: (k, cb) => { cb(); return () => {} }, register: (o, C) => { slots.C = C; return () => {} } }
api.apply({ slots, get: () => undefined })

// 渲染整棵树，找 bw-body 组，看盆在它里面还是外面
let tree = null
try { tree = slots.C() } catch (e) { console.log('✗ 渲染抛错:', e.message); process.exit(1) }

const ancestry = []
function walk(node, chain) {
  if (!node || typeof node !== 'object') return
  const cls = String((node.props && node.props.className) || '')
  const next = cls ? chain.concat(cls) : chain
  if (cls.includes('bw-head-basin')) ancestry.push(next.join(' > '))
  const kids = (node.children || []).concat(node.props && node.props.children ? (Array.isArray(node.props.children) ? node.props.children : [node.props.children]) : [])
  for (const k of kids) walk(k, next)
}
walk(tree, [])

let bad = 0
if (!ancestry.length) { console.log('✗ 树里找不到 bw-head-basin（idle 态应该有盆）'); bad++ }
for (const a of ancestry) {
  const inBody = /(^| )bw-body( |$)/.test(a.split(' > ').slice(0, -1).join(' '))
  console.log(`  ${inBody ? '✓' : '✗'} 盆的祖先链: ${a}`)
  console.log(`     ⇒ 在 .bw-body 内 = ${inBody}（false 即穿模：身体动画时盆不跟随）`)
  if (!inBody) bad++
}
// 盆与身体同组 ⇒ 呼吸/走路的 transform 必然作用于盆
console.log(bad ? `\n✗ ${bad} 项不通过：穿模未修复` : '\n✓ 穿模已修复：盆是 .bw-body 后代，刚性继承 breathe/waddle')
process.exit(bad ? 1 : 0)
