/**
 * dsh-basin-whale-pet — Host 半边
 *
 * 职责：把「DeepSeek 余额 + 赠金/充值 + 今日已用（观测）+ 峰谷时段」算好，
 * 从一条同源 HTTP 路由 `/dsh-basin-whale-pet/state.json` 下发给 Client 半边（头顶不锈钢盆的 Q 版女仆鲸鱼娘）。
 *
 * 取数走 DSH 官方通路，两条路互不干扰、API key 优先：
 *   ① `ctx.credentials.resolve('DEEPSEEK_API_KEY')` → https://api.deepseek.com/user/balance
 *   ② `ctx.get('deepseekAccount').getBalance(client)` —— 只登录 DSH 账号、没配 key 的用户。
 *      ⚠️ 必须是**可选服务**（ctx.get），绝不能写进 inject：老宿主没有这个服务时，进了 inject
 *      整个插件会永远等不到服务而完全不 apply（比没这个功能严重得多）。
 *
 * 除 GET 一条只读路由外不改动任何宿主状态；自己的观测账只写在 $DSH_HOME/dsh-basin-whale-pet/state.json。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const HOME = process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh')
const DATA_DIR = path.join(HOME, 'dsh-basin-whale-pet')
const STATE_FILE = path.join(DATA_DIR, 'state.json')

const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const BALANCE_TTL_MS = 20000        // 路由侧缓存，保护平台接口
const FAIL_BACKOFF_MS = 20000       // 两条路都失败后的退避（前端 60s 轮询时不要次次打接口）
const KEY_TIMEOUT_MS = 8000
const ACCOUNT_TIMEOUT_MS = 5000

export const inject = ['webServer', 'credentials']

// ============================================================================
// 峰谷时段（DeepSeek 官方计费规则）
// 高峰：北京时间 周一至周五（不含中国法定节假日）9:00–12:00、14:00–18:00
// 谷（空闲）：其余全部时段 —— 含周末、调休上班的周末、法定节假日全天
// 来源：https://api-docs.deepseek.com/zh-cn/quick_start/pricing
// ============================================================================
const PEAK_HOURS = [[9, 12], [14, 18]]

// ⚠️ 每年 11 月国务院发布次年放假安排后需要在这里补日期。
// 依据《国务院办公厅关于 2026 年部分节假日安排的通知》（国办发明电〔2025〕7 号）。
// 只列「放假」的日期；调休上班日全部落在周末，按周末谷价规则本来就是谷价。
const HOLIDAY_VALLEY = {
  '2026-01-01': 1, '2026-01-02': 1, '2026-01-03': 1,
  '2026-02-15': 1, '2026-02-16': 1, '2026-02-17': 1, '2026-02-18': 1, '2026-02-19': 1,
  '2026-02-20': 1, '2026-02-21': 1, '2026-02-22': 1, '2026-02-23': 1,
  '2026-04-04': 1, '2026-04-05': 1, '2026-04-06': 1,
  '2026-05-01': 1, '2026-05-02': 1, '2026-05-03': 1, '2026-05-04': 1, '2026-05-05': 1,
  '2026-06-19': 1, '2026-06-20': 1, '2026-06-21': 1,
  '2026-09-25': 1, '2026-09-26': 1, '2026-09-27': 1,
  '2026-10-01': 1, '2026-10-02': 1, '2026-10-03': 1, '2026-10-04': 1,
  '2026-10-05': 1, '2026-10-06': 1, '2026-10-07': 1,
}

/** epoch 秒 → 北京日历日 YYYY-MM-DD（+8h 平移后按 UTC 读） */
const bjDay = (sec) => new Date(sec * 1000 + 8 * 3600 * 1000).toISOString().slice(0, 10)

function isPeakTime(sec) {
  if (!Number.isFinite(Number(sec))) return false
  const bj = new Date(Number(sec) * 1000 + 8 * 3600 * 1000)
  const dow = bj.getUTCDay() // 0=周日 6=周六
  if (dow === 0 || dow === 6) return false            // 周末全天谷
  if (HOLIDAY_VALLEY[bj.toISOString().slice(0, 10)]) return false // 法定节假日全天谷
  const hour = bj.getUTCHours()
  return PEAK_HOURS.some(([s, e]) => hour >= s && hour < e)
}

/** 下一个峰谷切换时刻（epoch 秒）；与 isPeakTime 完全同源，只扫北京时间的 0/9/12/14/18 边界 */
function nextSwitchAt(sec) {
  const cur = isPeakTime(sec)
  const day0 = Math.floor((sec + 8 * 3600) / 86400) * 86400
  for (let d = 0; d <= 12; d++) {
    for (const edge of [0, 9, 12, 14, 18]) {
      const cand = day0 + d * 86400 + edge * 3600 - 8 * 3600
      if (cand <= sec + 1) continue
      if (isPeakTime(cand) !== cur) return cand
    }
  }
  return null
}

/** 今天 24 小时的峰谷分段（供 UI 画条带） */
function daySegments(sec) {
  const dayStart = Math.floor((sec + 8 * 3600) / 86400) * 86400 - 8 * 3600
  const segments = []
  for (let h = 0; h < 24; h++) {
    const peak = isPeakTime(dayStart + h * 3600 + 60)
    if (!segments.length || segments[segments.length - 1].peak !== peak) segments.push({ hour: h, peak })
  }
  return { dayStart, segments }
}

// ============================================================================
// 观测账本（今日已用）：余额下降记为消费；余额上升（充值/赠金）单独累加并抬高起点，
// 不会把已经发生的消费冲掉。金额按 1e-6 定点存，显示两位。
// ============================================================================
let ledger = null

function readLedger(scope) {
  let raw = null
  try { raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch (err) {}
  if (!raw || raw.version !== 1 || typeof raw !== 'object') raw = null
  // 换了账户/key（scope 不同）就另起一本，避免把别人的余额差算成今天的消费
  if (raw && raw.scope !== scope) raw = null
  return raw || { version: 1, scope, day: '', dayStart: null, last: null, credits: 0 }
}

function writeLedger() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(STATE_FILE, JSON.stringify(ledger), 'utf8')
  } catch (err) {
    console.warn('[dsh-basin-whale-pet] 观测账本写入失败：' + msg(err))
  }
}

function observe(balance, atSec, scope) {
  if (!ledger || ledger.scope !== scope) ledger = readLedger(scope)
  const day = bjDay(atSec)
  if (ledger.day !== day || typeof ledger.dayStart !== 'number') {
    ledger.day = day
    ledger.dayStart = balance
    ledger.credits = 0
    ledger.last = balance
    writeLedger()
    return
  }
  if (typeof ledger.last === 'number' && balance > ledger.last) {
    const gained = round6(balance - ledger.last)
    ledger.credits = round6(ledger.credits + gained)
    ledger.dayStart = round6(ledger.dayStart + gained) // 起点抬升 ⇒ 已观测消费不被充值冲掉
  }
  ledger.last = balance
  writeLedger()
}

/** 今日已用；跨到没有新观测的日子时返回 null（不拿昨天的数冒充今天） */
function todayUsed(atSec) {
  if (!ledger) return null
  if (ledger.day !== bjDay(atSec)) return null
  if (typeof ledger.dayStart !== 'number' || typeof ledger.last !== 'number') return null
  return round6(Math.max(0, ledger.dayStart - ledger.last))
}

const round6 = (n) => Math.round(Number(n) * 1e6) / 1e6
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)
const msg = (e) => String((e && e.message) || e).slice(0, 180)

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms)
    promise.then((v) => { clearTimeout(timer); resolve(v) }, (e) => { clearTimeout(timer); reject(e) })
  })
}

// ============================================================================
// 余额取数：两条路
// ============================================================================
let ctx

async function fetchByKey() {
  let cred = null
  try {
    cred = await withTimeout(ctx.credentials.resolve('DEEPSEEK_API_KEY'), KEY_TIMEOUT_MS, '凭据读取超时')
  } catch (err) {
    return { ok: false, stage: 'key', transient: true, error: '凭据读取失败：' + msg(err) }
  }
  if (!cred || !cred.value) return { ok: false, stage: 'key', error: '未配置 DEEPSEEK_API_KEY' }
  let res
  try {
    res = await withTimeout(fetch(BALANCE_URL, {
      headers: { Authorization: 'Bearer ' + String(cred.value), Accept: 'application/json' },
      signal: AbortSignal.timeout(KEY_TIMEOUT_MS),
    }), KEY_TIMEOUT_MS + 1000, '余额接口超时')
  } catch (err) {
    return { ok: false, stage: 'key', transient: true, error: '余额接口请求失败：' + msg(err) }
  }
  if (!res.ok) return { ok: false, stage: 'key', error: '余额接口 HTTP ' + res.status }
  let data
  try { data = await res.json() } catch (err) { return { ok: false, stage: 'key', error: '余额接口返回不是 JSON' } }
  const info = Array.isArray(data && data.balance_infos) ? data.balance_infos[0] : null
  const total = num(info && info.total_balance)
  if (total === null) return { ok: false, stage: 'key', error: '余额接口没有 total_balance 字段' }
  return {
    ok: true,
    source: 'apikey',
    total,
    recharge: num(info && info.topped_up_balance),
    bonus: num(info && info.granted_balance),
    currency: String((info && info.currency) || 'CNY').toUpperCase(),
    scope: 'k' + createHash('sha256').update(String(cred.value)).digest('hex').slice(0, 12),
  }
}

async function fetchByAccount() {
  let account = null
  try { account = typeof ctx.get === 'function' ? ctx.get('deepseekAccount') : null } catch (err) { account = null }
  if (!account || typeof account.getBalance !== 'function') {
    return { ok: false, stage: 'account', error: '当前 DSH 没有账号余额服务（未登录或版本不支持）' }
  }
  let result
  try {
    result = await withTimeout(account.getBalance({
      version: String(process.env.DSH_CLIENT_VERSION || process.env.DSH_VERSION || '') || 'unknown',
      locale: String(process.env.DSH_LOCALE || '') || 'zh_CN',
      timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
    }), ACCOUNT_TIMEOUT_MS, '账号余额请求超时')
  } catch (err) {
    return { ok: false, stage: 'account', transient: true, error: '账号余额调用失败：' + msg(err) }
  }
  if (!result) return { ok: false, stage: 'account', error: '未登录 DeepSeek 账号（没有账号凭据）' }
  if (result.status !== 'ready') return { ok: false, stage: 'account', error: '账号余额未就绪（' + String(result.status || 'unknown') + '）' }
  // 平台把钱包拆成 normal_wallets（充值）与 bonus_wallets（赠金）；很多账号只有赠金，
  // 两边要一起看，否则会被误判成「读不到余额」。
  const usable = (list) => (Array.isArray(list) ? list : []).filter((w) => w && num(w.balance) !== null)
  const norm = usable(result.value)
  const bonus = usable(result.bonusWallets)
  const all = norm.concat(bonus)
  if (!all.length) return { ok: false, stage: 'account', error: norm.length || bonus.length ? '钱包字段不可用' : '账号没有余额钱包' }
  const curOf = (w) => String((w && w.currency) || 'CNY').toUpperCase()
  const nonzero = all.filter((w) => Number(w.balance) > 0)
  const pick = nonzero.find((w) => curOf(w) === 'CNY') || nonzero[0] || all.find((w) => curOf(w) === 'CNY') || all[0]
  const currency = curOf(pick)
  const sum = (list) => round6(list.filter((w) => curOf(w) === currency).reduce((s, w) => s + Number(w.balance), 0))
  const recharge = sum(norm)
  const granted = sum(bonus)
  let userId = null
  try {
    const st = typeof account.getState === 'function' ? await account.getState() : null
    userId = (st && (st.userId || (st.profile && st.profile.userId))) || null
  } catch (err) {}
  return {
    ok: true,
    source: 'account',
    total: round6(recharge + granted), // 与 API key 路 total_balance 同口径
    recharge,
    bonus: granted,
    currency,
    scope: 'a' + createHash('sha256').update('account:' + String(userId || 'default')).digest('hex').slice(0, 12),
  }
}

async function fetchBalance() {
  const byKey = await fetchByKey()
  if (byKey.ok) return byKey
  const byAccount = await fetchByAccount()
  if (byAccount.ok) return byAccount
  return {
    ok: false,
    error: 'API key 路：' + String(byKey.error || '失败') + '；账号登录路：' + String(byAccount.error || '失败'),
    transient: !!(byKey.transient || byAccount.transient),
  }
}

// ============================================================================
// 下发给挂件的载荷
// ============================================================================
let good = null // 最近一次成功余额 { at, data }
let lastErr = null // 最近一次失败 { at, error, transient }

function payload() {
  const nowSec = Math.floor(Date.now() / 1000)
  const peak = isPeakTime(nowSec)
  const { dayStart, segments } = daySegments(nowSec)
  const fresh = good && Date.now() - good.at < BALANCE_TTL_MS * 3
  const used = fresh ? todayUsed(nowSec) : null
  return {
    ok: !!fresh,
    nowSec,
    dayStartSec: dayStart,
    segments,
    peak,
    tier: peak ? 'peak' : 'valley',
    multiplier: peak ? 2 : 1,
    peakHours: PEAK_HOURS,
    nextSwitchAt: nextSwitchAt(nowSec),
    currency: fresh ? good.data.currency : 'CNY',
    balance: fresh ? good.data.total : null,
    recharge: fresh ? good.data.recharge : null,
    bonus: fresh ? good.data.bonus : null,
    balanceSource: fresh ? good.data.source : null,
    balanceAgeMs: good ? Date.now() - good.at : null,
    todayUsed: used,
    todayCredits: fresh && ledger ? round6(ledger.credits || 0) : null,
    // 两条路都失败、且从没成功过时的原因；瞬时抖动时前端保留旧值并提示 stale
    error: !fresh ? String((lastErr && lastErr.error) || '余额还没取到（正在重试）') : '',
    stale: !fresh && !!(lastErr && lastErr.transient) && !!good,
  }
}

async function refresh(force) {
  const goodFresh = good && Date.now() - good.at < BALANCE_TTL_MS
  const errRecent = lastErr && Date.now() - lastErr.at < FAIL_BACKOFF_MS
  if (!force && (goodFresh || errRecent)) return payload() // 失败退避：别每分钟死磕一遍两条接口
  const r = await fetchBalance()
  if (r.ok) {
    good = { at: Date.now(), data: r }
    lastErr = null
    observe(r.total, Math.floor(Date.now() / 1000), r.scope)
  } else {
    lastErr = { at: Date.now(), error: r.error, transient: !!r.transient }
  }
  return payload()
}

// ============================================================================
// 浏览器信任栅栏：余额是账号数据，不能被子域/跨站脚本读走
// ============================================================================
function selfReject(req) {
  try {
    const headers = (req && req.headers) || {}
    let hostUrl = null
    try { hostUrl = new URL('http://' + String(headers.host || '')) } catch (err) { return 403 }
    const hn = hostUrl.hostname.toLowerCase()
    const loopback = hn === 'localhost' || hn.endsWith('.localhost') || hn === '::1'
      || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hn)
    if (!loopback) return 403
    if (String(headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return 403
    const origin = headers.origin
    if (typeof origin === 'string' && origin && origin !== 'null') {
      try { if (new URL(origin).host.toLowerCase() !== hostUrl.host.toLowerCase()) return 403 } catch (err) { return 403 }
    }
    return null
  } catch (err) { return 403 }
}

function guard(req) {
  const own = selfReject(req)
  if (own) return own
  try {
    const conn = typeof ctx.get === 'function' ? ctx.get('connection') : ctx.connection
    if (conn && typeof conn.requestRejection === 'function') {
      const rej = conn.requestRejection(req)
      // 宿主栅栏的返回形状：数字状态码（401/403…）或 { status }；undefined/null/false = 放行。
      // 任何其它真值一律按拒绝处理（fail-closed）—— 这里不能只看 .status，
      // 否则宿主给的 401 会被当成「没被拒」而放行（实测：未认证请求会拿到 401）。
      if (rej === undefined || rej === null || rej === false) return null
      if (typeof rej === 'number') return rej
      if (typeof rej === 'object' && Number.isFinite(Number(rej.status))) return Number(rej.status)
      return 403
    }
  } catch (err) {
    console.warn('[dsh-basin-whale-pet] 宿主信任栅栏抛异常，按拒绝处理：' + msg(err))
    return 403
  }
  return null
}

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
}

export function apply(host) {
  ctx = host

  host.webServer.register({
    kind: 'exact',
    path: '/dsh-basin-whale-pet/state.json',
    handler: async (req, res) => {
      const denied = guard(req)
      if (denied) {
        res.writeHead(denied, JSON_HEADERS)
        res.end(JSON.stringify({ ok: false, error: 'forbidden' }))
        return
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, JSON_HEADERS)
        res.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
        return
      }
      let body
      try {
        const force = new URL(req.url || '/', 'http://localhost').searchParams.get('refresh') === '1'
        body = await refresh(force)
      } catch (err) {
        body = Object.assign({}, payload(), { ok: false, error: msg(err) })
      }
      res.writeHead(200, JSON_HEADERS)
      res.end(JSON.stringify(body))
    },
  })

  // 预热一次：挂件首帧就有峰谷与倒计时（余额失败也不影响渲染，只是面板显示原因）
  const timer = setTimeout(() => { refresh(true).catch(() => {}) }, 1200)
  host.effect(() => () => clearTimeout(timer))
}
