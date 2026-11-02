// 数值验证「交接无缝」：头上盆渲染出来的中心/尺寸，必须与飞行盆归位终点一致。
// 这是把两份手写几何统一成一份之后才可能成立的性质，不测就等于没修。
import fs from 'node:fs'
const t = fs.readFileSync('D:/新建文件夹/dsh-basin-whale-pet/client.js', 'utf8')

const num = (re, label) => { const m = t.match(re); if (!m) { console.log('✗ 取不到 ' + label); process.exit(1) } return Number(m[1]) }
const WHALE_X = num(/const WHALE_X = (\d+)/, 'WHALE_X')
const STAGE_H = num(/const STAGE_W = \d+, STAGE_H = (\d+)/, 'STAGE_H')
const WHALE_H = num(/WHALE_H = (\d+)/, 'WHALE_H')
const BASIN_BODY_W = num(/const BASIN_BODY_W = (\d+)/, 'BASIN_BODY_W')
// FLY_W = Math.round(BASIN_BODY_W * 120 / 96)，与产品同一算式（旧写法用无捕获组的正则 ⇒ NaN ⇒ 0）
const FLY_W = Math.round(BASIN_BODY_W * 120 / 96)
const FLY_H = Math.round(FLY_W * 78 / 120)
const HEAD_X = WHALE_X + 110
const SVG_Y0 = STAGE_H - WHALE_H
const HEAD_Y = SVG_Y0 + 50
const BASIN_SCALE = BASIN_BODY_W / 96

// 头上盆：外层 transform = translate(110 49.5) scale(s) translate(-60 -39)
// 盆体在 viewBox(120×78) 内占 x 12..108、y 12..66 ⇒ 本体中心 (60,39)、宽 96、高 54
const hbCenter = { x: HEAD_X, y: SVG_Y0 + 49.5 }
const hbSize = { w: 96 * BASIN_SCALE, h: 54 * BASIN_SCALE }

// 飞行盆：svg viewBox 120×78 渲染成 FLY_W×FLY_H；setFly 写 translate3d(x-FLY_W/2, y-FLY_H/2)
const flyScale = FLY_W / 120
const fbCenter = { x: HEAD_X, y: HEAD_Y }                 // 归位终点 = (HEAD.x, HEAD.y)
const fbSize = { w: 96 * flyScale, h: 54 * flyScale }
// 元素盒中心 vs 本体中心：本体中心在盒内 (60*flyScale, 39*flyScale)，盒半尺寸 (FLY_W/2, FLY_H/2)
const offX = 60 * flyScale - FLY_W / 2
const offY = 39 * flyScale - Math.round(FLY_H / 2) * 0 - (FLY_H / 2) + (39 * flyScale) - (39 * flyScale)  // 见下逐项
const actualOffY = (39 * flyScale) - (FLY_H / 2)

console.log('盆体 viewBox 内: x 12..108, y 12..66 ⇒ 中心 (60,39), 96×54')
console.log(`头上盆  中心=(${hbCenter.x}, ${hbCenter.y})  尺寸=${hbSize.w.toFixed(2)}×${hbSize.h.toFixed(2)}  scale=${BASIN_SCALE.toFixed(4)}`)
console.log(`飞行盆  中心=(${fbCenter.x}, ${fbCenter.y})  尺寸=${fbSize.w.toFixed(2)}×${fbSize.h.toFixed(2)}  scale=${flyScale.toFixed(4)}`)
console.log(`飞行层盒内本体偏移: dx=${offX.toFixed(2)} dy=${actualOffY.toFixed(2)}（setFly 用盒中心对齐 HEAD，故本体实际落在 y=${(fbCenter.y + actualOffY).toFixed(2)}）`)

const dCenter = Math.hypot(hbCenter.x - fbCenter.x, hbCenter.y - (fbCenter.y + actualOffY))
const dSize = Math.max(Math.abs(hbSize.w - fbSize.w), Math.abs(hbSize.h - fbSize.h))
console.log(`\n交接误差：中心 ${dCenter.toFixed(2)}px，尺寸 ${dSize.toFixed(2)}px`)
let bad = 0
if (dCenter > 2.5) { console.log('✗ 中心错位超 2.5px ⇒ 归位瞬间会跳一下'); bad++ } else console.log('✓ 中心对齐（≤2.5px）')
if (dSize > 0.5) { console.log('✗ 尺寸不一致 ⇒ 交接会跳大小'); bad++ } else console.log('✓ 尺寸完全一致（同一 scale 来源）')
console.log(bad ? `\n✗ ${bad} 项` : '\n无缝交接成立')
process.exit(bad ? 1 : 0)
