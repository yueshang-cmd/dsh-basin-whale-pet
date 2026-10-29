/**
 * 一键上传总控（幂等：再跑一次只补没做完的部分）
 *
 *   node scripts/upload.mjs --owner yueshang-whale --name "月殇" --email 12345+user@users.noreply.github.com
 *
 * 凭据从**仓库之外**读取（默认 D:\新建文件夹\.secrets，可用 --secrets <dir> 覆盖），
 * 因此这个脚本可以安全提交进公开仓库：里面没有任何密钥，也不会把密钥拷进仓库。
 * 脚本只读取、绝不打印 token 内容。
 *
 * 缺哪个凭据就跳过对应步骤并说明原因；两个都没有时只做本地 commit。
 *
 * 步骤（每步先看现状，失败即停并如实报告）：
 *   1 替换 <GITHUB_OWNER>（package.json + 投稿文件名）
 *   2 preflight 闸门 → git commit
 *   3 建 GitHub 仓库（不存在才建）+ 加 dsh-plugin topic
 *   4 git push（走 SSH：本机 github.com 的 HTTPS 被墙，SSH 22/443 实测可达）
 *   5 npm publish（临时 userconfig 喂 token，用完删除；不写全局 npmrc）
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GIT = process.env.GIT_EXE || 'D:\\Git\\cmd\\git.exe'
const NPM = process.env.NPM_CMD || 'C:\\Program Files\\nodejs\\npm.cmd'
const RUN_TIMEOUT_MS = 120000
const PKG = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name)
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt
}
const OWNER = arg('owner', '')
const NAME = arg('name', '')
const EMAIL = arg('email', '')
const SECRETS = path.resolve(arg('secrets', 'D:\\新建文件夹\\.secrets'))
const SKIP_NPM = process.argv.includes('--skip-npm')
const DRY = process.argv.includes('--dry-run')

const say = (tag, m) => console.log(`${tag} ${m}`)
const step = (m) => console.log('\n▶ ' + m)
const die = (m) => { console.log('\n✗ ' + m + '\n后续步骤未执行。'); process.exit(1) }

function readSecret(file) {
  const p = path.join(SECRETS, file)
  if (!fs.existsSync(p)) return null
  const v = fs.readFileSync(p, 'utf8').trim()
  return v.length >= 12 ? v : null
}

/**
 * 默认全部捕获（探针不会往控制台倒 stderr）；live 为真时才直连输出。
 * BatchMode/GIT_TERMINAL_PROMPT=0 保证 ssh 或凭据提示直接失败退出，不会挂死。
 */
function git(args, { timeout = RUN_TIMEOUT_MS, live = false } = {}) {
  return execFileSync(GIT, args, {
    cwd: ROOT, encoding: 'utf8', timeout, killSignal: 'SIGKILL',
    stdio: live ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', SSH_ASKPASS: 'echo', GIT_SSH_COMMAND: GIT_SSH_OVERRIDE() },
  })
}
function GIT_SSH_OVERRIDE() {
  if (process.env.GIT_SSH_COMMAND) return process.env.GIT_SSH_COMMAND
  const ssh = process.env.DSH_SSH || 'D:/Git/usr/bin/ssh.exe'
  return fs.existsSync(ssh)
    ? `"${ssh}" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20`
    : 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20'
}
const cap = (args, opts) => {
  try { return { ok: true, out: git(args, opts).trim() } } catch (e) { return { ok: false, out: String(e.stderr || e.stdout || e.message).trim().split('\n')[0] } }
}

// 任何没被我包住的异常都只报一行，不要把 Node 栈倒给用户看。
process.on('uncaughtException', (e) => { console.log('\n✗ 意外中断：' + String(e && e.message || e).split('\n')[0] + '\n脚本幂等，修好后可直接重跑。'); process.exit(1) })

async function gh(pathname, { method = 'GET', body, token } = {}) {
  const r = await fetch('https://api.github.com' + pathname, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dsh-basin-whale-pet-upload',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  })
  let json = null
  try { json = await r.json() } catch (e) {}
  return { status: r.status, json }
}

// —————————————————————————————————— 0. 前置
step('0/5 参数与凭据检查')
if (DRY) say('·', 'DRY RUN：只读现状与校验，不写文件、不建仓库、不推送、不发布')
if (!OWNER) die('缺 --owner。例：node scripts/upload.mjs --owner yueshang-whale --name "月殇" --email 123+user@users.noreply.github.com')
if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(OWNER)) {
  die(`--owner "${OWNER}" 不符合 GitHub 用户名规则（字母/数字/单个连字符，不以连字符开头结尾；中文只能当显示名）`)
}
const ghToken = readSecret('gh-token')
const npmToken = readSecret('npm-token')
say('·', `owner = ${OWNER}`)
say('·', `secrets 目录 = ${SECRETS}${fs.existsSync(SECRETS) ? '' : '（不存在）'}`)
say('·', `gh-token  ${ghToken ? '已读到（不打印内容）' : '缺失 → 跳过建仓库/推送'}`)
say('·', `npm-token ${npmToken ? '已读到（不打印内容）' : '缺失 → 跳过发布'}`)
say('·', `git = ${cap(['--version']).out || '不可用（设 GIT_EXE 指定）'}`)
if (!cap(['--version']).ok) die('git 不可用')

// 先保证这是个 git 仓库：不是就 init。否则后面的 config / add / commit 会直接炸。
{
  const inside = cap(['rev-parse', '--is-inside-work-tree'])
  if (!inside.ok) {
    if (DRY) say('·', 'DRY：本步会 git init')
    else {
      const r = cap(['-c', 'init.defaultBranch=main', 'init'])
      if (!r.ok) die('git init 失败：' + r.out)
      say('✓', '已 git init（此前不是仓库）')
    }
  } else say('·', '已在 git 仓库内')
}

// —————————————————————————————————— 1. owner 替换
step('1/5 写入仓库地址与投稿文件名')
{
  const pkgPath = path.join(ROOT, 'package.json')
  const p = PKG()
  const blob = JSON.stringify(p.repository) + JSON.stringify(p.bugs) + JSON.stringify(p.homepage)
  if (blob.includes('<GITHUB_OWNER>')) {
    if (DRY) say('·', 'DRY：本步会改写 repository/bugs/homepage 并改名投稿文件')
    else {
      p.repository.url = `git+https://github.com/${OWNER}/${p.name}.git`
      p.bugs.url = `https://github.com/${OWNER}/${p.name}/issues`
      p.homepage = `https://github.com/${OWNER}/${p.name}#readme`
      fs.writeFileSync(pkgPath, JSON.stringify(p, null, 2) + '\n', 'utf8')
      say('✓', 'package.json 的 repository / bugs / homepage 已写入真实 owner')
      const wanted = path.join(ROOT, `${OWNER}__${p.name}.yml`)
      const sub = path.join(ROOT, 'SUBMISSION.yml')
      if (fs.existsSync(sub)) {
        fs.writeFileSync(sub, fs.readFileSync(sub, 'utf8').split('<GITHUB_OWNER>').join(OWNER), 'utf8')
        fs.renameSync(sub, wanted)
        say('✓', `SUBMISSION.yml → ${path.basename(wanted)}`)
      }
    }
  } else say('=', '已是真实 owner，跳过')
  if (!DRY && !fs.existsSync(path.join(ROOT, 'SUBMISSION.yml')) && !fs.existsSync(path.join(ROOT, `${OWNER}__${p.name}.yml`))) {
    die('找不到投稿文件（SUBMISSION.yml 或 <owner>__<name>.yml）')
  }
}

// —————————————————————————————————— 2. 闸门 + commit
step('2/5 发布闸门与本地提交')
if (!DRY) {
  try { execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'preflight.mjs')], { cwd: ROOT, stdio: 'inherit', timeout: 60000 }) }
  catch (e) { die('preflight 未通过 —— 不会推/发一个不合格或不一致的包') }
  say('✓', 'preflight 通过')
} else say('·', 'DRY：跳过 preflight（实际跑时会拦）')

if (NAME && EMAIL) { if (!DRY) { git(['config', 'user.name', NAME]); git(['config', 'user.email', EMAIL]) }; say('✓', `署名 ${NAME} <${EMAIL}>`) }
else say('!', '没给 --name/--email：我不替你编作者身份，commit 会停在这里')

{
  const head = cap(['rev-parse', '--verify', '-q', 'HEAD'])
  if (!head.ok) {
    if (DRY) say('·', 'DRY：无 HEAD，实际会 add -A 并 commit 一次')
    else {
      if (!NAME || !EMAIL) die('需要 commit 但缺署名 → 补 --name/--email 再跑')
      git(['add', '-A'])
      git(['commit', '-q', '-m', 'feat: steel-basin whale maid desktop pet for DeepSeek Harness'])
      say('✓', '已提交 ' + cap(['log', '--oneline', '-1']).out)
    }
  } else say('=', '已有提交 ' + cap(['log', '--oneline', '-1']).out)
}
const pkgName = PKG().name
const branch = cap(['rev-parse', '--abbrev-ref', 'HEAD']).out || 'main'

// —————————————————————————————————— 3/4. 仓库 + 推送
step('3/5 建 GitHub 仓库')
if (!ghToken) { say('!', '无 gh-token → 跳过建仓库与推送'); }
else {
  const who = await gh('/user', { token: ghToken })
  if (who.status !== 200) die(`gh-token 无效/权限不足（HTTP ${who.status} ${who.json && who.json.message || ''}）`)
  const real = who.json.login
  if (real.toLowerCase() !== OWNER.toLowerCase()) say('!', `token 属于 ${real}，与 --owner ${OWNER} 不同 → 用 ${real} 作为实际 owner`)
  const url = `https://github.com/${real}/${pkgName}`
  if (DRY) { say('·', `DRY：会确保 ${url} 存在、设置 topic、然后 push ${branch} 到 git@github.com:${real}/${pkgName}.git`); }
  else {
    const exists = await gh(`/repos/${real}/${pkgName}`, { token: ghToken })
    if (exists.status === 200) say('=', `仓库已存在 ${url}`)
    else {
      const created = await gh('/user/repos', {
        method: 'POST', token: ghToken,
        body: { name: pkgName, private: false, description: PKG().description, homepage: url + '#readme', has_issues: true, has_wiki: false, auto_init: false },
      })
      if (created.status !== 201) die(`建仓库失败 HTTP ${created.status}：${created.json && created.json.message}`)
      say('✓', '仓库已创建 ' + url)
    }
    const patch = await gh(`/repos/${real}/${pkgName}`, {
      method: 'PATCH', token: ghToken,
      body: { topics: ['dsh', 'dsh-plugin', 'deepseek-harness', 'desktop-pet', 'balance', 'peak-valley'], homepage: url + '#readme', description: PKG().description },
    })
    say(patch.status === 200 ? '✓' : '!', `topic/描述 ${patch.status === 200 ? '已设置（含 dsh-plugin，目录 CI 要看它）' : 'HTTP ' + patch.status + ' —— 请手动加 topic: dsh-plugin'}`)

    step('4/5 推送（SSH）')
    const sshUrl = `git@github.com:${real}/${pkgName}.git`
    const remote = cap(['remote', 'get-url', 'origin'])
    if (!remote.ok) git(['remote', 'add', 'origin', sshUrl])
    else if (remote.out !== sshUrl) { git(['remote', 'set-url', 'origin', sshUrl]); say('=', 'remote 改指 SSH') }
    else say('=', 'remote 已就位')
    try {
      git(['push', '-u', 'origin', branch], { timeout: 300000 })
      const ref = await gh(`/repos/${real}/${pkgName}/git/refs/heads/${branch}`, { token: ghToken })
      say(ref.status === 200 ? '✓' : '!', `远端 ${branch} ${ref.status === 200 ? '已确认，commit ' + ref.json.object.sha.slice(0, 7) : '核验 HTTP ' + ref.status}`)
    } catch (e) {
      const msg = String(e.stderr || e.message).split('\n').filter(Boolean).slice(0, 3).join(' / ')
      say('✗', 'push 失败：' + msg.slice(0, 300))
      say('·', '最可能原因：这把公钥还没加到你的 GitHub 账号（Settings → SSH and GPG keys）。'
        + '公钥全文见 D:\\新建文件夹\\月殇-上传操作单.md；加完再跑一次本命令即可（幂等）。')
      if (!npmToken) die('推送未成功，且没有 npm token，流程到此')
      say('·', '继续尝试 npm publish（包内容与仓库无关）')
    }
  }
}

// —————————————————————————————————— 5. npm publish
step('5/5 发布到 npm')
if (SKIP_NPM) say('!', '按 --skip-npm 跳过')
else if (!npmToken) say('!', '无 npm-token → 跳过。需要 npm 的 **Automation** token（普通 token 发不了包），'
  + '写到 ' + path.join(SECRETS, 'npm-token'))
else if (DRY) say('·', 'DRY：会用临时 userconfig 跑 npm publish（不写全局 npmrc）')
else {
  if (!fs.existsSync(NPM)) die('找不到 npm.cmd，设 NPM_CMD 指定')
  // 临时 userconfig：不把 token 写进全局 ~/.npmrc。
  // 注意 Windows 不实现 Unix 0600 语义，这只是"临时文件 + 事后删除"，不是加密存放。
  const tmp = path.join(os.tmpdir(), `.npmrc-basin-${process.pid}`)
  try {
    fs.writeFileSync(tmp, `//registry.npmjs.org/:_authToken=${npmToken}\nregistry=https://registry.npmjs.org/\n`)
    execFileSync(NPM, ['publish', '--userconfig', tmp, '--access', 'public', '--loglevel', 'warn'], {
      cwd: ROOT, stdio: 'inherit', timeout: 300000,
      env: { ...process.env, npm_config_cache: path.join(os.tmpdir(), 'dsh-npm-cache'), HOME: process.env.HOME || os.homedir() },
    })
    say('✓', '已发布 https://www.npmjs.com/package/' + pkgName)
  } catch (e) {
    say('✗', 'npm publish 失败：' + String(e.message).split('\n')[0].slice(0, 300))
    say('·', '401/403 → token 类型要是 Automation；E404→名字被占先改包名；EPERM → npm 缓存目录不可写（本脚本已把它指到临时目录）')
  } finally {
    try { fs.rmSync(tmp, { force: true }); say('·', '临时 userconfig 已删除（token 未落进全局 npmrc）') }
    catch (e) { say('!', '请手工删除临时凭据文件：' + tmp) }
  }
}

console.log('\n———————————————————————————')
console.log('目录收录（这一步要你在浏览器点，约 1 分钟）：')
console.log(`  1) fork https://github.com/awesome-dsh-plugin/awesome-dsh-plugin`)
console.log(`  2) 在 fork 里新增文件 data/plugins/${OWNER}__${pkgName}.yml`)
console.log(`  3) 内容粘贴仓库里的同名文件（owner 已替换好），提 PR`)
console.log('  ⚠️ 目录 CI 要求仓库创建满 1 天；未满会被挡，过一天自动重跑，不用重开 PR。')
console.log('  两个 README 由脚本生成，别手改。')
