/**
 * 发布前自检（npm prepublishOnly 会自动跑，也可 npm run preflight）
 *
 * 对照 awesome-dsh-plugin 目录的硬性规则 + 打包正确性检查。
 * 任何一条不过就 exit(1) —— 让 `npm publish` 直接失败，而不是把一个
 * 装不上/链不回仓库的包推到线上。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const fail = []
const warn = []
const ok = []

const pkg = JSON.parse(read('package.json'))

// —— 1. 目录要求：必须声明 dsh.bundle（只声明 dsh.client 是最常见的被拒原因）——
if (pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch) ok.push(`dsh.bundle.patch = ${pkg.dsh.bundle.patch}`)
else fail.push('package.json 缺 dsh.bundle.patch —— 目录会直接拒收，且 dsh plugin add 装不了')

// —— 2. patch 文件存在，且 name 与包名一致 ——
const patchRel = String((pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch) || '').replace(/^\.\//, '')
if (patchRel) {
  if (!fs.existsSync(path.join(ROOT, patchRel))) fail.push(`patch 文件不存在：${patchRel}`)
  else {
    const patch = read(patchRel)
    if (!patch.includes(pkg.name)) fail.push(`${patchRel} 里的 name 不是 ${pkg.name}（loader 会解析成另一个包）`)
    else ok.push(`${patchRel} 的 name 与包名一致`)
    if (/^\s*-\s+insert:/m.test(patch)) ok.push('patch 用 insert 挂载（不会被当成对官方行的覆盖）')
    else warn.push('patch 没看到 `- insert:`，请确认是新增行而不是覆盖别人的行')
  }
}

// —— 3. Client 模块 id 必须等于包名 ——
const clientSrc = read('client.js')
const idMatch = clientSrc.match(/window\.__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/)
if (!idMatch) fail.push('client.js 里找不到 window.__ModuleLoader__.load({ id: ... }')
else if (idMatch[1] !== pkg.name) fail.push(`client 模块 id ${idMatch[1]} ≠ 包名 ${pkg.name}（宿主按包名装配，不匹配就加载不上）`)
else ok.push(`client 模块 id = ${idMatch[1]}`)

// —— 4. 可发布性 ——
if (pkg.private) fail.push('package.json 里 private:true —— npm 会拒绝 publish')
else ok.push('private 未设，npm 允许发布')
if (/^@[lo]ocal\//.test(pkg.name)) fail.push(`包名 ${pkg.name} 的 scope 不是你的 npm 组织，发不出去`)
else ok.push(`包名 ${pkg.name}`)
if (pkg.dependencies && Object.keys(pkg.dependencies).length) {
  warn.push(`有运行时依赖 ${Object.keys(pkg.dependencies).join(', ')} —— 官方 @deepseek-ai/* 应改用 peerDependencies`)
} else ok.push('零运行时依赖（官方包不需要 peerDependencies，也就不必声明 engines.dsh）')

// —— 5. 仓库链接：目录靠它把 npm 包关联到仓库，写死占位符等于没关联 ——
const repoUrl = String((pkg.repository && pkg.repository.url) || '')
if (!repoUrl) fail.push('缺 repository 字段')
else if (/<GITHUB_OWNER>|\bYOUR_USERNAME\b|owner\/repo/.test(repoUrl)) fail.push(`repository 还是占位符：${repoUrl} —— 换成真实 owner 再发（目录要求包与仓库互相认领，占位符会让两者关联不上）`)
else ok.push(`repository = ${repoUrl}`)

// —— 6. 展示资源（Plugin Manager 与设置页要读）——
for (const rel of ['locale/zh.json', 'locale/en.json']) {
  if (!fs.existsSync(path.join(ROOT, rel))) { fail.push(`缺 ${rel}`); continue }
  const meta = JSON.parse(read(rel)).meta
  if (!meta || !meta.title || !meta.description) fail.push(`${rel} 缺 meta.title / meta.description`)
  else ok.push(`${rel} → ${meta.title}`)
}
const iconRel = String(pkg.icon || '').replace(/^\.\//, '')
if (!iconRel) warn.push('没有顶层 icon 字段')
else if (!fs.existsSync(path.join(ROOT, iconRel))) fail.push(`icon 指向的文件不存在：${iconRel}`)
else {
  const bytes = fs.statSync(path.join(ROOT, iconRel)).size
  if (bytes > 256 * 1024) fail.push(`图标超过 256 KiB：${bytes}`)
  else ok.push(`icon ${iconRel} ${bytes} B`)
}

// —— 7. 别把本地开发文件打进包 ——
const filesList = Array.isArray(pkg.files) ? pkg.files : []
if (!filesList.length) warn.push('没有 files 白名单，npm 会把整个目录打包')
else {
  for (const leaked of ['scripts', 'selfcheck.mjs', 'smoke.mjs', 'host-smoke.mjs', 'render-shot.mjs']) {
    if (filesList.some((f) => f.includes(leaked))) fail.push(`files 白名单里混进了开发文件：${leaked}`)
  }
  ok.push(`files 白名单 ${filesList.length} 项`)
}

// —— 8. 语义：描述里说的东西代码里真的有（目录会逐句对着代码核）——
const indexSrc = read('index.js')
const claims = [
  ['余额', /total_balance|getBalance/],
  ['赠金/充值拆分', /bonusWallets|granted_balance/],
  ['今日已用（观测）', /todayUsed|observe\(/],
  ['峰谷时段', /isPeakTime|PEAK_HOURS/],
  ['24 小时条带', /daySegments|segments/],
  ['切换倒计时', /nextSwitchAt/],
  ['法定节假日谷价', /HOLIDAY_VALLEY/],
]
for (const [what, re] of claims) {
  if (re.test(indexSrc)) ok.push(`代码确有「${what}」`)
  else fail.push(`描述声称有「${what}」，但 index.js 里找不到对应实现`)
}
const year = new Date().getFullYear()
if (!indexSrc.includes(`20${String(year + 1).slice(-2)}`) && !indexSrc.includes(`${year + 1}`)) {
  warn.push(`HOLIDAY_VALLEY 只覆盖到 ${year} 年；次年 11 月国务院公布安排后要补下一年节假日`)
}

// —— 9. 安全：路由必须带信任栅栏（余额是账号数据）——
if (/requestRejection/.test(indexSrc) && /isLoopbackHostname|loopback/.test(indexSrc)) ok.push('路由有回环 + 宿主栅栏双层校验')
else fail.push('路由缺少信任栅栏 —— 会把账号余额暴露给任意来源')
if (/rej\.status/.test(indexSrc) && !/typeof rej === 'number'/.test(indexSrc)) fail.push('栅栏只读 rej.status，会漏掉宿主返回的数字状态码（401 被放行）')

console.log('通过：')
for (const line of ok) console.log('  ✓ ' + line)
if (warn.length) { console.log('\n提醒：'); for (const line of warn) console.log('  ~ ' + line) }
if (fail.length) {
  console.log('\n必须修（npm publish 已阻断）：')
  for (const line of fail) console.log('  ✗ ' + line)
  process.exit(1)
}
console.log('\npreflight passed —— 可以 npm publish（先 npm login）。')
