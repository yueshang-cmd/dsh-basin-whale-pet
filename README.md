# dsh-basin-whale-pet · 不锈钢盆鲸鱼娘（DSH 桌面宠物）

Q 版女仆鲸鱼娘，头顶一只**不锈钢盆**，蹲在 DeepSeek Harness 的页面上替你盯余额。

点一下那个盆 —— 盆被击飞（抛物线、撞边弹回、落地翻滚），鲸鱼娘惊慌喷水，一路小跑过去把盆捡回来扣回头上。

余额 / 赠金 / 充值 / 今日已用 / 峰谷时段就在她头顶的面板上，含 24 小时峰谷条带与切换倒计时。

![插件图标](icon.svg)

## 安装

```sh
dsh plugin add dsh-basin-whale-pet
```

桌面客户端请在应用内 **设置 → 插件** 搜索 `dsh-basin-whale-pet` 安装（桌面端用的是 `desktop` profile，命令行 `--profile web` 装不到它）。装完刷新页面即可，无需重启。

## 显示的内容

| 行 | 含义 |
|---|---|
| **DeepSeek 余额** | 充值余额 + 赠金，与官方 `total_balance` 同口径 |
| **今日已用** | 用余额差**观测**出来的消费（见下方「今日已用是观测值」） |
| **赠金 / 充值余额** | 两个钱包各自单独一行；取不到显示 `—` |
| **PEAK ×2 / OFF-PEAK ×1** | 当前时段 + 距下一次切换的倒计时 |
| **24 小时条带** | 今天的峰谷分布（红=高峰，绿=谷），白竖线是当前时刻 |

取数走 DSH 官方通路，两条路互不干扰、**API key 优先**：

1. DSH 凭据里的 `DEEPSEEK_API_KEY` → `https://api.deepseek.com/user/balance`
2. **DSH 账号登录态** → 在「设置 → 账号与余额」登录过即可，**不需要去 platform 建 API key**

两条路都失败时，面板会同时写明两边各自的原因（而不是笼统一句「读不到」）。余额接口本身有 20 秒缓存 + 失败退避，不会每分钟死磕平台。

## 峰谷规则

DeepSeek 官方计费说明（[pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)）：

- **高峰** = 北京时间 周一至周五 **9:00–12:00、14:00–18:00**，单价 ×2
- **谷（空闲）** = 其余全部时段，**包括周末、调休上班的周末、以及法定节假日全天**

2026 年法定节假日表内置在 `index.js` 的 `HOLIDAY_VALLEY`（依据国办发明电〔2025〕7 号）。
**次年 11 月国务院公布安排后需要补日期** —— 只列「放假」的日子即可，调休上班日落在周末、按周末规则本来就是谷价。`npm run preflight` 会在这件事到期时提醒。

## 交互

- **点不锈钢盆** → 盆被击飞：真抛物线 + 撞舞台边/顶弹回 + 落地弹跳翻滚，方向由你点在盆的哪一侧决定，力度带随机抖动；停稳后鲸鱼娘跑过去、蹲下捡起、抱着盆走回原位、扣回头上，「叮」一声归位。整条 `knocked → chase → pickup → carry → happy → idle` 可以中途被打断重放。
- **点鲸鱼娘** → 强制刷新余额 + 随机冒一句吐槽（内置 16 句）
- **按住拖动** → 自由摆放，位置存 `localStorage`；默认**左下角**（与右下角的 `dsh-whale-widget` 错开）
- **面板 `♪`** 音效开关、**`▾/▴`** 收起展开

音效是运行期 **WebAudio 合成**的金属撞击 / 归位叮 / 跑动沙沙 —— 不加载任何音频文件，包里也没有二进制素材。

## 美术与授权

鲸鱼娘、不锈钢盆、面板全部是**手写 SVG 矢量**，本仓库原创绘制；角色取向参考公开的 DeepSeek「鲸鱼娘」社区梗图方向，但**不含任何第三方图像、音频或字体素材**。MIT 授权。

## 今日已用是观测值

「今日已用」靠两次余额读的差推算：余额下降记为消费，余额上升（充值/赠金）单独累加并把起点抬起来，所以充值不会把已经花掉的数冲掉。它**不是账单** —— 窗口内没落账的消耗看不到；跨到没有新观测的那天不显示数字，而不是拿昨天的数冒充今天。要精确金额请以 platform 账单为准。

账本按账户 / key 分 scope（`$DSH_HOME/dsh-basin-whale-pet/state.json`），换了账户不会把别人的余额差算成自己的消费。

## 隐私与本机限制

- 挂件只从**同源** `GET /dsh-basin-whale-pet/state.json` 读数据；余额由宿主取，浏览器端不碰任何 key。
- 该路由是**只读**的，插件不写宿主配置、不注册工具、不改提示词。
- 路由带双层信任栅栏（回环/同源自校验 + 委托宿主 `connection.requestRejection`，异常一律 fail-closed）。因此**只能在本机 DSH 页面上出数**；Host 非回环时按 403 拒绝。
- 拖动位置与音效开关只存当前浏览器的 `localStorage`，清缓存回到默认。

## 开发

```sh
npm run check          # 语法 + 三套测试 + 发布前自检
node scripts/selfcheck.mjs     # 峰谷规则/倒计时/24h 分段（含周末、调休、节假日、跨年）
node scripts/host-smoke.mjs    # 宿主路由：余额拆分、缓存、观测账本、失败文案、403/405、栅栏返回形状
node scripts/smoke.mjs         # 前端：迷你 React 跑首帧 + 整条击飞动画
npm run preview        # 导出静态 HTML 预览（scripts/render-shot.mjs）
```

三套测试都**不需要浏览器、不联网**（余额用假实现，峰谷另有一份独立编写的规则做对照）。

结构：

```
index.js           宿主半边：取余额、算峰谷、观测记账、一条只读路由 + 信任栅栏
client.js          浏览器半边：SVG 美术、击飞/追/捡动画、余额面板
cordis.patch.yml   挂载声明（- insert）
locale/{zh,en}.json  插件管理页的标题与说明
icon.svg           插件图标
scripts/           测试与预览（不进发布包）
```

## 发布

`prepublishOnly` 会自动跑 `scripts/preflight.mjs`，逐项核对目录的硬性要求
（`dsh.bundle` 声明、client 模块 id 与包名一致、展示资源、描述与代码相符、
信任栅栏存在、`repository` 不是占位符）。任何一项不过，`npm publish` 直接失败。

```sh
npm login
npm publish
```

## 已知边界

- 「今日已用」是观测值，见上。
- 法定节假日表只覆盖到 2026 年，需每年补。
- 位置记忆是浏览器级的，换浏览器/清缓存回到默认左下角。

## 相关插件

同类里已经存在的几个，供对比选择：

- [`dsh-whale-widget`](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) —— 功能面最全的余额挂件（自定义泡泡、多厂商、账本）
- [`dsh-game-hud`](https://github.com/guoliyuan97-png/dsh-game-hud) —— 游戏 HUD 风：余额 HP 条 + 上下文 MP 条 + 峰谷倒计时
- [`dsh-xiaoke-widget`](https://github.com/aklnaaw/dsh-xiaoke-widget) —— Claude  persona 桌面宠物 + 余额/峰谷/可编辑泡泡

这个包的差异点在**盆被击飞 → 跑过去捡回来**这条物理交互，以及零素材依赖的全矢量美术。默认位置刻意与 `dsh-whale-widget` 错开，两者可以共存。
