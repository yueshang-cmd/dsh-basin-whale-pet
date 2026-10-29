/**
 * 一次性把发布占位符换成真实 GitHub owner。
 *
 *   node scripts/set-owner.mjs <owner>
 *
 * 会改写 package.json 的 repository / bugs / homepage，以及 SUBMISSION.yml 的
 * url / name / icon 注释，并把 SUBMISSION.yml 重命名成目录要求的
 * <owner>__dsh-basin-whale-pet.yml。跑完自动执行 preflight 验证。
 *
 * 不做的事：不碰 src 代码、不猜 owner、不改包名（npm 名与仓库名必须一致，
 * 目录靠这两者互相认领）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const PLACEHOLDER = '<GITHUB_OWNER>'

const owner = (process.argv[2] || '').trim().replace(/^@/, '').replace(/\/.*$/, '')
if (!owner) {
  console.log('用法：node scripts/set-owner.mjs <github-owner>\n例如：node scripts/set-owner.mjs octocat')
  console.log('当前占位符：' + PLACEHOLDER)
  process.exit(2)
}
if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(owner)) {
  console.error(`✗ "${owner}" 不是合法的 GitHub 用户名（1–39 位，字母数字与单连字符，不能以连字符开头/结尾）`)
  process.exit(2)
}

let changed = 0
function subst(file, map) {
  const p = path.join(ROOT, file)
  if (!fs.existsSync(p)) { console.log(`  - 跳过（不存在）：${file}`); return }
  let t = fs.readFileSync(p, 'utf8')
  const before = t
  for (const [from, to] of map) t = t.split(from).join(to)
  if (t !== before) { fs.writeFileSync(p, t, 'utf8'); changed++; console.log(`  ✓ 改写 ${file}`) }
  else console.log(`  = 无变化 ${file}`)
}

console.log(`owner := ${owner}   (${PKG.name})\n`)
subst('package.json', [[PLACEHOLDER, owner]])
subst('SUBMISSION.yml', [[PLACEHOLDER, owner]])

// 目录要求投稿文件名 = <owner>__<repo>.yml
const repo = PKG.name.replace(/^@[^/]+\//, '')
const wanted = path.join(ROOT, `${owner}__${repo}.yml`)
const current = path.join(ROOT, 'SUBMISSION.yml')
if (fs.existsSync(current)) {
  fs.renameSync(current, wanted)
  console.log(`  ✓ SUBMISSION.yml → ${path.basename(wanted)}`)
}

// 复核：不该再有占位符
const leftover = []
for (const f of ['package.json', path.basename(wanted)]) {
  const p = path.join(ROOT, f)
  if (fs.existsSync(p) && fs.readFileSync(p, 'utf8').includes(PLACEHOLDER)) leftover.push(f)
}
if (leftover.length) { console.error('\n✗ 仍有占位符残留：' + leftover.join(', ')); process.exit(1) }

console.log('\n发布前自检：')
const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'preflight.mjs')], { stdio: 'inherit' })
if (r.status !== 0) { console.error('\n✗ preflight 没过，先按上面提示修'); process.exit(r.status) }

console.log(`
下一步（在你自己的终端里做，需要你的凭据）：

  1) 建仓库 https://github.com/${owner}/${repo}
     - 加上 topic：dsh-plugin
     - 等仓库满 1 天再提目录 PR（CI 会自动检查这条）

  2) 推代码
     git init && git add -A && git commit -m "feat: basin whale desktop pet"
     git remote add origin https://github.com/${owner}/${repo}.git
     git push -u origin main

  3) 发 npm
     npm login
     npm publish          # prepublishOnly 会自动跑 preflight

  4) 往 awesome-dsh-plugin 提 PR：加一个文件
     data/plugins/${owner}__${repo}.yml
     （内容就是仓库里这份 ${owner}__${repo}.yml，改个位置放而已；README 由脚本生成，别手改）

  5)（可选）发 GitHub Release 并挂预构建包，市场会优先用它装：
     npm pack
     资产名不带版本号，条目里写
     tarball: https://github.com/${owner}/${repo}/releases/latest/download/${repo}.tgz
`)
