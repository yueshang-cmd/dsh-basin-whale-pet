// 宿主半边的独立自检：直接跑导出的 apply() 需要 cordis，这里只验证纯逻辑部分。
// 用 vm 把 index.js 里的函数拉出来测（不联网）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js'), 'utf8')

// 截取纯函数段（从 PEAK_HOURS 到 withTimeout），塞进一个可执行模块
const start = src.indexOf('const PEAK_HOURS')
const end = src.indexOf('// 观测账本')
const logic = src.slice(start, end)
const tmp = path.join(path.dirname(fileURLToPath(import.meta.url)), '.selfcheck-logic.mjs')
fs.writeFileSync(tmp, logic + '\nexport { isPeakTime, nextSwitchAt, daySegments, bjDay, HOLIDAY_VALLEY, PEAK_HOURS }\n')
const mod = await import('./.selfcheck-logic.mjs')
fs.unlinkSync(tmp)

const { isPeakTime, nextSwitchAt, daySegments, bjDay } = mod

// 北京时间 2026-10-29 = 周四
const bj = (y, mo, d, hh, mi = 0) => Math.floor(Date.UTC(y, mo - 1, d, hh - 8, mi) / 1000)

let fails = 0
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) { fails++; console.log('FAIL', label, 'got', got, 'want', want) }
  else console.log('ok  ', label, '=', JSON.stringify(got))
}

check('周四 09:30 峰', isPeakTime(bj(2026, 10, 29, 9, 30)), true)
check('周四 11:59 峰', isPeakTime(bj(2026, 10, 29, 11, 59)), true)
check('周四 12:00 谷', isPeakTime(bj(2026, 10, 29, 12, 0)), false)
check('周四 14:00 峰', isPeakTime(bj(2026, 10, 29, 14, 0)), true)
check('周四 17:59 峰', isPeakTime(bj(2026, 10, 29, 17, 59)), true)
check('周四 18:00 谷', isPeakTime(bj(2026, 10, 29, 18, 0)), false)
check('周四 01:36 谷（现在）', isPeakTime(bj(2026, 10, 29, 1, 36)), false)
check('周六全天谷', isPeakTime(bj(2026, 10, 31, 10, 0)), false)
check('周日全天谷', isPeakTime(bj(2026, 11, 1, 10, 0)), false)
check('调休上班的周六仍谷', isPeakTime(bj(2026, 10, 10, 10, 0)), false) // 2026-10-10 周六上班，按周末谷
check('清明 4/5 10:00 谷（节假日）', isPeakTime(bj(2026, 4, 5, 10, 0)), false)
check('10/8 周四 10:00 峰', isPeakTime(bj(2026, 10, 8, 10, 0)), true)
check('2027 无节假日表→普通周三峰', isPeakTime(bj(2027, 3, 3, 10, 0)), true)

// 倒计时
check('周四 11:30 → 12:00 切换 = 1800s', nextSwitchAt(bj(2026, 10, 29, 11, 30)) - bj(2026, 10, 29, 11, 30), 1800)
check('周四 13:00 → 14:00 切换 = 3600s', nextSwitchAt(bj(2026, 10, 29, 13, 0)) - bj(2026, 10, 29, 13, 0), 3600)
check('周四 01:36 → 09:00 切换', nextSwitchAt(bj(2026, 10, 29, 1, 36)) - bj(2026, 10, 29, 1, 36), (9 * 3600 - 1 * 3600 - 36 * 60))
check('周六 10:00 → 周一 09:00 = 47h', (nextSwitchAt(bj(2026, 10, 31, 10, 0)) - bj(2026, 10, 31, 10, 0)) / 3600, 47)

// 24 小时分段
const seg = daySegments(bj(2026, 10, 29, 12, 0)).segments
check('周四分段', seg, [
  { hour: 0, peak: false }, { hour: 9, peak: true }, { hour: 12, peak: false },
  { hour: 14, peak: true }, { hour: 18, peak: false },
])
const segSat = daySegments(bj(2026, 10, 31, 12, 0)).segments
check('周六全谷分段', segSat, [{ hour: 0, peak: false }])
check('bjDay 跨年正确', bjDay(bj(2026, 12, 31, 23, 30)), '2026-12-31')
check('bjDay 午夜', bjDay(bj(2027, 1, 1, 0, 0)), '2027-01-01')

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed')
process.exit(fails ? 1 : 0)
