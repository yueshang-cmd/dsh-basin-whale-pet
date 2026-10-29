/**
 * Host 半边冒烟：注入假 webServer / credentials / deepseekAccount，真跑一遍路由与记账。
 * 不联网：余额走「账号登录路」的假实现；另测两条路都失败时的错误文案。
 * 运行：node host-smoke.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'basin-test-'))
process.env.DSH_HOME = tmpHome

const mod = await import(new URL('../index.js', import.meta.url).href)

let route = null
let emits = []
const fakeAccount = {
  calls: 0,
  async getBalance() {
    this.calls++
    return {
      status: 'ready',
      value: [{ balance: '28.2000', currency: 'CNY' }],
      bonusWallets: [{ balance: '1.0800', currency: 'CNY' }],
    }
  },
  async getState() { return { userId: '4242' } },
}
const ctx = {
  webServer: { register(r) { route = r; return () => {} } },
  credentials: { resolve: async () => { throw new Error('测试：没有凭据服务返回值') } },
  effect(fn) { if (typeof fn === 'function') { const d = fn(); if (typeof d === 'function') d() } },
  on(name, fn) { emits.push(name); return () => {} },
  get(name) { return name === 'deepseekAccount' ? fakeAccount : undefined },
}

mod.apply(ctx)
const errors = []
if (!route) errors.push('没有注册路由')
if (route && route.path !== '/dsh-basin-whale-pet/state.json') errors.push('路由路径不对：' + route.path)
if (route && route.kind !== 'exact') errors.push('kind 应为 exact')

function mkReq(url, headers = {}) {
  return {
    method: 'GET', url,
    headers: { host: '127.0.0.1:61207', ...headers },
  }
}
function mkRes() {
  const res = { code: 0, headers: null, body: '' }
  res.writeHead = (c, hd) => { res.code = c; res.headers = hd }
  res.end = (b) => { res.body = b }
  return res
}

async function hit(url, headers) {
  const req = mkReq(url, headers)
  const res = mkRes()
  await route.handler(req, res)
  return { res, json: (() => { try { return JSON.parse(res.body) } catch (e) { return null } })() }
}

// —— 1. 正常取数（账号路）——
const a = await hit('/dsh-basin-whale-pet/state.json')
if (a.res.code !== 200) errors.push('状态码 ' + a.res.code)
const j = a.json || {}
const need = ['ok', 'nowSec', 'dayStartSec', 'segments', 'peak', 'nextSwitchAt', 'currency', 'balance', 'recharge', 'bonus', 'balanceSource', 'todayUsed', 'error', 'stale', 'peakHours', 'tier', 'multiplier']
for (const k of need) if (!(k in j)) errors.push('响应缺字段 ' + k)
if (!j.ok) errors.push('应取到余额，实际 error=' + j.error)
if (j.balance !== 29.28) errors.push('余额应为 29.28，实际 ' + j.balance)
if (j.recharge !== 28.2 || j.bonus !== 1.08) errors.push('充值/赠金拆分不对：' + j.recharge + '/' + j.bonus)
if (j.currency !== 'CNY') errors.push('币种 ' + j.currency)
if (j.balanceSource !== 'account') errors.push('来源 ' + j.balanceSource)
if (j.todayUsed !== 0) errors.push('首次观测今日已用应为 0，实际 ' + j.todayUsed)
if (!Array.isArray(j.segments) || !j.segments.length) errors.push('segments 为空')
if (typeof j.nextSwitchAt !== 'number') errors.push('nextSwitchAt 不是数字')
if (j.tier !== (j.peak ? 'peak' : 'valley') || j.multiplier !== (j.peak ? 2 : 1)) errors.push('tier/multiplier 与 peak 不一致')
// peak 用**测试自己写的**规则做独立对照（不复用被测代码），且按真实当前时刻判：
// 高峰 = 北京 周一~周五 的 9–12、14–18；2026 年放假日期手抄一份。
const HOLIDAY = new Set(['2026-01-01', '2026-01-02', '2026-01-03', '2026-02-15', '2026-02-16',
  '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
  '2026-04-04', '2026-04-05', '2026-04-06', '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04',
  '2026-05-05', '2026-06-19', '2026-06-20', '2026-06-21', '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'])
const expectPeak = (sec) => {
  const d = new Date(sec * 1000 + 8 * 3600 * 1000)
  const dow = d.getUTCDay()
  if (dow === 0 || dow === 6) return false
  if (HOLIDAY.has(d.toISOString().slice(0, 10))) return false
  const hh = d.getUTCHours()
  return (hh >= 9 && hh < 12) || (hh >= 14 && hh < 18)
}
if (j.peak !== expectPeak(j.nowSec)) errors.push(`peak 判定与独立规则不符：peak=${j.peak} 期望=${expectPeak(j.nowSec)} nowSec=${j.nowSec}`)
if (j.nextSwitchAt <= j.nowSec) errors.push('nextSwitchAt 应在未来')
if (j.peak === expectPeak(j.nextSwitchAt)) errors.push('切换时刻两侧峰谷应相反')

// —— 2. 瞬时缓存：第二次不带 refresh 应该复用，不重复打账号接口 ——
const callsAfter1 = fakeAccount.calls
await hit('/dsh-basin-whale-pet/state.json')
if (fakeAccount.calls !== callsAfter1) errors.push('20 秒内不该重取余额（calls ' + callsAfter1 + '→' + fakeAccount.calls + '）')
await hit('/dsh-basin-whale-pet/state.json?refresh=1')
if (fakeAccount.calls !== callsAfter1 + 1) errors.push('?refresh=1 应强制重取一次')

// —— 3. 观测账本：余额下降 → 今日已用增加；余额上升 → 抬起点、记 credits ——
const led = path.join(tmpHome, 'dsh-basin-whale-pet', 'state.json')
fakeAccount.getBalance = async () => ({
  status: 'ready',
  value: [{ balance: '28.0000', currency: 'CNY' }],  // 总 29.08：比上次少 0.2
  bonusWallets: [{ balance: '1.0800', currency: 'CNY' }],
})
let r = await hit('/dsh-basin-whale-pet/state.json?refresh=1')
if (Math.abs(r.json.balance - 29.08) > 1e-9) errors.push('第二次余额 ' + r.json.balance)
if (Math.abs(r.json.todayUsed - 0.2) > 1e-6) errors.push('今日已用应 0.2，实际 ' + r.json.todayUsed)

fakeAccount.getBalance = async () => ({
  status: 'ready',
  value: [{ balance: '48.0000', currency: 'CNY' }],  // 总 49.08：比上次（29.08）多 20
  bonusWallets: [{ balance: '1.0800', currency: 'CNY' }],
})
r = await hit('/dsh-basin-whale-pet/state.json?refresh=1')
if (Math.abs(r.json.todayUsed - 0.2) > 1e-6) errors.push('充值不该冲掉已观测消费：' + r.json.todayUsed)
if (Math.abs(r.json.todayCredits - 20) > 1e-6) errors.push('入账应 20，实际 ' + r.json.todayCredits)

// —— 4. 账本文件内容 ——
const disk = JSON.parse(fs.readFileSync(led, 'utf8'))
if (disk.version !== 1) errors.push('账本 version')
if (typeof disk.scope !== 'string' || !/^a[0-9a-f]{12}$/.test(disk.scope)) errors.push('scope 形状不对：' + disk.scope)

// —— 5a. 宿主栅栏的各种返回形状都必须被正确理解（回归：曾经只读 .status，把 401 当成放行）——
async function fenceCase(name, ret, expect) {
  ctx.get = (key) => (key === 'connection' ? { requestRejection: () => ret } : null)
  const res = await hit('/dsh-basin-whale-pet/state.json')
  if (res.res.code !== expect) errors.push(`栅栏返回 ${name} 应 ${expect}，实际 ${res.res.code}`)
}
await fenceCase('数字 401', 401, 401)
await fenceCase('数字 403', 403, 403)
await fenceCase('{status:403}', { status: 403 }, 403)
await fenceCase('undefined（放行）', undefined, 200)
await fenceCase('null（放行）', null, 200)
await fenceCase('false（放行）', false, 200)
ctx.get = () => null

// —— 5b. 取数失败但有成功历史：沿用旧余额，不糊 UI ——
ctx.credentials.resolve = async () => null
r = await hit('/dsh-basin-whale-pet/state.json?refresh=1')
if (r.json.ok !== true) errors.push('有成功历史时取数失败应沿用旧余额，实际 ok=' + r.json.ok + ' error=' + r.json.error)
if (r.json.balance !== 49.08) errors.push('沿用的旧余额不对：' + r.json.balance)

// —— 5c. 从一开始就两条路都失败（全新模块实例，避免共享模块级状态）——
const mod2 = await import(new URL('../index.js?fail=1', import.meta.url).href)
let route2 = null
const failCtx = {
  webServer: { register(rr) { route2 = rr; return () => {} } },
  credentials: { resolve: async () => null },   // 没配 key
  effect() {}, on() { return () => {} },
  get() { return null },                         // 老宿主：没有账号服务
}
mod2.apply(failCtx)
async function hit2(url, headers) {
  const res = mkRes()
  await route2.handler(mkReq(url, headers), res)
  return { res, json: JSON.parse(res.body) }
}
r = await hit2('/dsh-basin-whale-pet/state.json?refresh=1')
if (r.json.ok !== false) errors.push('无 key 无账号时应 ok:false')
if (!/未配置 DEEPSEEK_API_KEY/.test(r.json.error) || !/没有账号余额服务/.test(r.json.error)) {
  errors.push('失败原因应同时带上两条路：' + r.json.error)
}
if (r.json.balance !== null) errors.push('失败时 balance 应为 null')
if (r.json.todayUsed !== null) errors.push('没取到余额时 todayUsed 应为 null')

// —— 6. 信任栅栏 ——
const bad = await new Promise(async (resolve) => {
  const res = mkRes()
  await route.handler(mkReq('/dsh-basin-whale-pet/state.json', { host: 'evil.example.com' }), res)
  resolve(res)
})
if (bad.code !== 403) errors.push('外部 Host 应 403，实际 ' + bad.code)
const xsite = await new Promise(async (resolve) => {
  const res = mkRes()
  await route.handler(mkReq('/dsh-basin-whale-pet/state.json', { 'sec-fetch-site': 'cross-site' }), res)
  resolve(res)
})
if (xsite.code !== 403) errors.push('跨站请求应 403，实际 ' + xsite.code)
const crossOrigin = await new Promise(async (resolve) => {
  const res = mkRes()
  await route.handler(mkReq('/dsh-basin-whale-pet/state.json', { origin: 'http://127.0.0.1:9999' }), res)
  resolve(res)
})
if (crossOrigin.code !== 403) errors.push('不同源 Origin 应 403，实际 ' + crossOrigin.code)
const post = await new Promise(async (resolve) => {
  const req = mkReq('/dsh-basin-whale-pet/state.json'); req.method = 'POST'
  const res = mkRes()
  await route.handler(req, res)
  resolve(res)
})
if (post.code !== 405) errors.push('POST 应 405，实际 ' + post.code)

fs.rmSync(tmpHome, { recursive: true, force: true })
if (errors.length) { console.log('\n问题：\n - ' + errors.join('\n - ')); process.exit(1) }
console.log('host smoke passed：余额拆分 · 缓存/强刷 · 观测账本(扣费/充值抬起点) · 双路失败文案 · 403/405 栅栏')
