// 关键交叉校验：client 的取数路径必须与 host 注册的路径逐字一致，
// 否则插件装得上、跑得动，但永远读不到数（这种错最容易漏）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const client = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')
const host = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8')
const patch = fs.readFileSync(path.join(ROOT, 'cordis.patch.yml'), 'utf8')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

const api = (client.match(/const API = '([^']+)'/) || [, null])[1]
const route = (host.match(/path: '([^']+)'/) || [, null])[1]
const moduleId = (client.match(/__ModuleLoader__\.load\(\{\s*id: '([^']+)'/) || [, null])[1]
const rowId = (patch.match(/- id: (\S+)/) || [, null])[1]
const rowName = (patch.match(/name: '([^']+)'/) || [, null])[1]
const dataDir = (host.match(/path\.join\(HOME, '([^']+)'\)/) || [, null])[1]
const pos = (client.match(/POS_STORE = '([^']+)'/) || [, null])[1]
const pref = (client.match(/PREF_STORE = '([^']+)'/) || [, null])[1]

const checks = [
  ['client API == host route', !!api && api === route, `${api} vs ${route}`],
  ['client 模块 id == 包名', moduleId === pkg.name, `${moduleId} vs ${pkg.name}`],
  ['patch name == 包名', rowName === pkg.name, `${rowName} vs ${pkg.name}`],
  ['loader 行 id 唯一（带包名前缀）', rowId === pkg.name, rowId],
  ['两把 localStorage 键不同且非空', !!pos && !!pref && pos !== pref && !/\*\*\*/.test(pos + pref), `${pos} | ${pref}`],
  ['账本目录已命名空间化', dataDir === pkg.name, dataDir],
  ['路由与账本目录同源前缀', !!route && route.includes(String(dataDir)), `${route} / ${dataDir}`],
  ['dsh.bundle.patch 声明存在', !!(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch), ''],
  ['dsh.client.platform = web', pkg.dsh && pkg.dsh.client && pkg.dsh.client.platform === 'web', ''],
  ['没有 private 阻断', !pkg.private, ''],
  ['files 覆盖全部运行时文件', ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'LICENSE'].every((f) => pkg.files.includes(f) || pkg.files.includes('locale/*.json')), pkg.files.join(',')],
]

let bad = 0
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '  →  ' + detail : ''}`)
  if (!ok) bad++
}

// 与开发副本的隔离：四组标识符必须全部不同（否则两个安装会互相遮蔽路由/slot）
const DEV = path.resolve(ROOT, '..', 'basin-whale-pet')
if (fs.existsSync(path.join(DEV, 'index.js'))) {
  const dClient = fs.readFileSync(path.join(DEV, 'client.js'), 'utf8')
  const dHost = fs.readFileSync(path.join(DEV, 'index.js'), 'utf8')
  const dApi = (dClient.match(/const API = '([^']+)'/) || [, null])[1]
  const dRoute = (dHost.match(/path: '([^']+)'/) || [, null])[1]
  const dPos = (dClient.match(/POS_STORE = '([^']+)'/) || [, null])[1]
  const dSlot = (dClient.match(/id: 'basin-whale-pet'/) ? 'basin-whale-pet' : null)
  const pairs = [['取数路径', api, dApi], ['注册 slot id', moduleId, dSlot], ['localStorage 键', pos, dPos]]
  console.log('\n与本地开发副本的隔离（必须全部不同）：')
  for (const [n, pub, dev] of pairs) {
    const diff = pub !== dev
    console.log(`  ${diff ? '✓' : '✗'} ${n}: pub=${pub} dev=${dev}`)
    if (!diff) bad++
  }
  if (route === dRoute) { console.log(`  ✗ host 路由与开发副本相同：${route}`); bad++ }
  else console.log(`  ✓ host 路由不同: pub=${route} dev=${dRoute}`)
}

console.log(bad ? `\nFAIL ${bad}` : '\n全部一致 —— 路由/包名/命名空间三者对齐')
process.exit(bad ? 1 : 0)
