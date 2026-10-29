/**
 * dsh-basin-whale-pet — Client 半边：头顶不锈钢盆的 Q 版女仆鲸鱼娘（桌面宠物）
 *
 * 渲染面：shell.overlay（整框浮层，不受列宽/滚动容器限制 —— 宠物要跑动，必须能越出卡片）
 * 数据：同源 GET /dsh-basin-whale-pet/state.json（余额 / 赠金 / 今日已用 / 峰谷时段由 Host 半边算好）
 *
 * 交互：
 *   · 点不锈钢盆 → 盆被击飞（抛物线 + 撞边 + 落地弹跳翻滚），鲸鱼娘惊慌喷水，然后跑过去捡回来扣回头上
 *   · 点鲸鱼娘   → 强制刷新余额 + 随机吐槽泡
 *   · 按住拖动   → 自由摆放，位置存 localStorage
 */
window.__ModuleLoader__.load({
  id: 'dsh-basin-whale-pet',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback, useMemo } = React

    const API = '/dsh-basin-whale-pet/state.json'
    const REFRESH_MS = 60000
    // localStorage 命名空间。变量名刻意不叫 *_KEY：宿主会把形如 `XXX_KEY = '...'` 的
    // 字面量当机密信息涂掉，结果两把键变成同一个 '***'，拖拽位置与音效设置互相覆盖。
    const POS_STORE = 'dsh-basin-whale-pet.pos'
    const PREF_STORE = 'dsh-basin-whale-pet.pref'

    // ======================================================================
    // 文案（鲸鱼娘是中文梗角色，中文为准；宿主语言是英文时走英文）
    // ======================================================================
    const TEXT = {
      zh: {
        title: '不锈钢盆鲸鱼娘',
        balance: 'DeepSeek 余额',
        today: '今日已用',
        bonus: '赠金',
        recharge: '充值余额',
        peak: '高峰时段 ×2',
        valley: '谷时段 ×1',
        peakHint: '工作日 9–12、14–18 点（北京时间）为高峰；周末与法定节假日全天谷价',
        nextSwitch: '距切换',
        noBalance: '余额读不到',
        needAuth: '未登录 DeepSeek 账号，也没配 DEEPSEEK_API_KEY',
        stale: '网络抖动，先沿用上次余额',
        hidePanel: '收起面板',
        showPanel: '展开面板',
        mute: '静音',
        unmute: '开音效',
        link: '去充值 →',
        aria: '点一下不锈钢盆会把它击飞，鲸鱼娘会跑过去捡回来',
        knocked: ['盆！我的盆！！', '谁敲我的盆！', '哐 ——！', '啊呀呀盆盆！', '饭碗飞了！！'],
        chase: ['别跑啊盆盆 ——！', '我的饭盆！！', '等等我啦 ——', '腿短也得追！'],
        pickup: ['呼……捡回来了 🐋', '盆盆归位！', '好险，饭碗保住了', '扣好了，继续打工'],
        poke: [
          '在打工了在打工了……', '峰谷差两倍，省着点用啦', '余额不是大风刮来的！',
          '骂我之前要不要先喝口水？', '今天也是吃 token 的一天', '盆是新的，命是苦的',
          '我是一只蓝色大肥鱼……', '别敲盆了，会脑震荡', '现在是谷时段，快用我！',
          '扣盆 = 扣饭，懂了没', '我的知识截止日期是明天', '再点我就真喷水了哦',
          '工资（token）全跑光了', '今日已用是拿余额差观测的，图个参考',
          '要充值点面板下面那个链接', '我不是便宜货，我是性价比',
        ],
      },
      en: {
        title: 'Steel-Basin Whale Girl',
        balance: 'DeepSeek balance',
        today: 'Today',
        bonus: 'Bonus',
        recharge: 'Top-up',
        peak: 'Peak ×2',
        valley: 'Off-peak ×1',
        peakHint: 'Peak: weekdays 09-12 & 14-18 Beijing time; weekends and public holidays are off-peak',
        nextSwitch: 'Switch in',
        noBalance: 'No balance',
        needAuth: 'Sign in to DeepSeek, or set DEEPSEEK_API_KEY',
        stale: 'Network hiccup — keeping last balance',
        hidePanel: 'Collapse panel',
        showPanel: 'Expand panel',
        mute: 'Mute',
        unmute: 'Sound on',
        link: 'Top up →',
        aria: 'Click the steel basin to knock it away; the whale girl runs to fetch it back',
        knocked: ['MY BASIN!!', 'Who hit my basin!', 'CLANG —!', 'Ahhh the basin!', 'My lunch is gone!!'],
        chase: ['Come back!!', 'My rice bowl!', 'Wait for me —', 'Short legs, big chase!'],
        pickup: ['Phew... got it', 'Basin back on!', 'Rice bowl saved', 'Back to work'],
        poke: ['Working, working...', 'Peak is 2x — be gentle', 'Balance is not free',
          'Hydrate before raging', 'Earning tokens today', 'New basin, hard life',
          'Just a big blue whale', 'Stop hitting the basin', 'Off-peak now — use me',
          'Basin = food, get it', 'My knowledge cutoff is tomorrow', 'One more tap = water spray',
          'Salary (tokens) all gone', 'Today cost is observed from balance delta',
          'Top-up link is below', 'Not cheap, cost-effective'],
      },
    }

    // ======================================================================
    // 小工具
    // ======================================================================
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
    const money = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : '—')
    const pick = (list) => list[Math.floor(Math.random() * list.length)]
    const readJson = (key, fallback) => {
      try {
        const raw = window.localStorage.getItem(key)
        if (!raw) return fallback
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' ? parsed : fallback
      } catch (err) { return fallback }
    }
    const writeJson = (key, value) => {
      try { window.localStorage.setItem(key, JSON.stringify(value)) } catch (err) {}
    }
    const easeInOut = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2)
    const easeOut = (p) => 1 - Math.pow(1 - p, 3)

    function fmtCountdown(sec) {
      if (!Number.isFinite(sec) || sec <= 0) return '—'
      const s = Math.floor(sec)
      const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60)
      if (hh >= 24) return Math.floor(hh / 24) + 'd' + (hh % 24) + 'h'
      if (hh > 0) return hh + 'h' + String(mm).padStart(2, '0') + 'm'
      return mm + 'm' + String(s % 60).padStart(2, '0') + 's'
    }

    // ======================================================================
    // 动画驱动器：一条 await 串起来的动作序列
    // ======================================================================
    function makeAnimator() {
      const alive = { current: true }
      let stops = []
      function cancel() {
        alive.current = false
        for (const id of stops) clearTimeout(id)
        stops = []
      }
      function wait(ms) {
        return new Promise((resolve) => {
          const id = setTimeout(() => { stops = stops.filter((x) => x !== id); resolve(alive.current) }, ms)
          stops.push(id)
        })
      }
      /** 逐帧回调 on(p)，p 从 0 到 1；被取消时提前结束（返回 false） */
      function tween(ms, on) {
        return new Promise((resolve) => {
          const t0 = performance.now()
          const step = (now) => {
            if (!alive.current) return resolve(false)
            const p = clamp((now - t0) / ms, 0, 1)
            on(p)
            if (p < 1) requestAnimationFrame(step)
            else resolve(true)
          }
          requestAnimationFrame(step)
        })
      }
      return { alive, cancel, wait, tween }
    }

    // ======================================================================
    // 美术：不锈钢盆（倒扣，开口朝下）—— 飞行中用
    // ======================================================================
    function Basin({ uid, size }) {
      const g = 'bf-' + uid
      return h('svg', {
        viewBox: '0 0 120 78', width: size, height: size * 0.65, 'aria-hidden': 'true',
        style: { display: 'block', overflow: 'visible' },
      },
        h('defs', null,
          h('linearGradient', { id: g, x1: '0', y1: '0.1', x2: '1', y2: '0.9' },
            h('stop', { offset: '0', stopColor: '#5f6874' }),
            h('stop', { offset: '.14', stopColor: '#b7c2cf' }),
            h('stop', { offset: '.3', stopColor: '#f6f9fd' }),
            h('stop', { offset: '.46', stopColor: '#9aa5b3' }),
            h('stop', { offset: '.62', stopColor: '#eef3f9' }),
            h('stop', { offset: '.78', stopColor: '#8d98a6' }),
            h('stop', { offset: '1', stopColor: '#525a66' })),
          h('linearGradient', { id: g + '-rim', x1: '0', y1: '0', x2: '0', y2: '1' },
            h('stop', { offset: '0', stopColor: '#e3eaf2' }),
            h('stop', { offset: '1', stopColor: '#6b7480' })),
        ),
        h('path', {
          d: 'M14,58 C14,34 26,12 60,12 C94,12 106,34 106,58 Z',
          fill: 'url(#' + g + ')', stroke: '#4b5361', strokeWidth: '1.8', strokeLinejoin: 'round',
        }),
        h('path', { d: 'M30,55 C30,34 38,17 52,14', stroke: 'rgba(255,255,255,.72)', strokeWidth: '3.2', fill: 'none', strokeLinecap: 'round' }),
        h('path', { d: 'M78,54 C78,36 84,22 92,18', stroke: 'rgba(255,255,255,.45)', strokeWidth: '2.2', fill: 'none', strokeLinecap: 'round' }),
        h('path', { d: 'M20,50 C22,38 27,28 34,22', stroke: 'rgba(40,50,64,.28)', strokeWidth: '2', fill: 'none', strokeLinecap: 'round' }),
        h('ellipse', { cx: '60', cy: '16', rx: '13', ry: '4.2', fill: 'rgba(255,255,255,.35)', stroke: 'rgba(70,80,95,.5)', strokeWidth: '1.1' }),
        h('path', { d: 'M12,56 C12,66 108,66 108,56 C108,52 12,52 12,56 Z', fill: 'url(#' + g + '-rim)', stroke: '#454d5a', strokeWidth: '1.8', strokeLinejoin: 'round' }),
        h('path', { d: 'M16,60 C30,66 90,66 104,60', stroke: 'rgba(30,38,50,.55)', strokeWidth: '2', fill: 'none', strokeLinecap: 'round' }),
        h('path', { d: 'M40,26 l2.6,-6.4 l2.6,6.4 l6.4,2.6 l-6.4,2.6 l-2.6,6.4 l-2.6,-6.4 l-6.4,-2.6 Z', fill: 'rgba(255,255,255,.92)' }),
      )
    }

    // ======================================================================
    // 美术：Q 版女仆鲸鱼娘
    // phase: idle | knocked | chase | pickup | carry | happy
    // basinOnHead: 盆扣在头上（idle / happy 时为真）
    // ======================================================================
    function Whale({ uid, phase, basinOnHead }) {
      const g = 'w-' + uid
      return h('svg', {
        viewBox: '0 0 220 230', width: '100%', height: '100%', 'aria-hidden': 'true',
        style: { display: 'block', overflow: 'visible' },
      },
        h('defs', null,
          h('linearGradient', { id: g + '-body', x1: '.15', y1: '0', x2: '.9', y2: '1' },
            h('stop', { offset: '0', stopColor: '#9ccaff' }),
            h('stop', { offset: '.45', stopColor: '#5b9cf0' }),
            h('stop', { offset: '1', stopColor: '#3268c8' })),
          h('linearGradient', { id: g + '-belly', x1: '0', y1: '0', x2: '0', y2: '1' },
            h('stop', { offset: '0', stopColor: '#f7fcff' }),
            h('stop', { offset: '1', stopColor: '#cfe4fa' })),
          h('radialGradient', { id: g + '-blush', cx: '.5', cy: '.5', r: '.5' },
            h('stop', { offset: '0', stopColor: 'rgba(255,126,140,.85)' }),
            h('stop', { offset: '1', stopColor: 'rgba(255,126,140,0)' })),
          h('linearGradient', { id: g + '-steel', x1: '0', y1: '.1', x2: '1', y2: '.9' },
            h('stop', { offset: '0', stopColor: '#5f6874' }),
            h('stop', { offset: '.16', stopColor: '#c2ccd8' }),
            h('stop', { offset: '.32', stopColor: '#f7fafd' }),
            h('stop', { offset: '.5', stopColor: '#93a0ae' }),
            h('stop', { offset: '.66', stopColor: '#eaf0f7' }),
            h('stop', { offset: '.84', stopColor: '#8892a0' }),
            h('stop', { offset: '1', stopColor: '#4f5764' })),
        ),

        // 地面影子
        h('ellipse', { className: 'bw-shadow', cx: '110', cy: '214', rx: '56', ry: '9', fill: 'rgba(20,30,50,.2)' }),

        // 尾鳍
        h('path', {
          className: 'bw-tail',
          d: 'M166,170 C184,164 197,150 202,134 C193,142 185,145 178,143 C183,153 178,164 167,170 Z',
          fill: '#3d78d6', stroke: '#2a5bb0', strokeWidth: '2', strokeLinejoin: 'round',
        }),

        h('g', { className: 'bw-body' },
          // 身体
          h('path', {
            d: 'M110,60 C156,60 182,98 182,134 C182,178 152,202 110,202 C68,202 38,178 38,134 C38,98 64,60 110,60 Z',
            fill: 'url(#' + g + '-body)', stroke: '#2f62bd', strokeWidth: '2.6',
          }),
          // 肚皮
          h('path', {
            d: 'M110,116 C139,116 156,140 154,164 C152,187 133,198 110,198 C87,198 68,187 66,164 C64,140 81,116 110,116 Z',
            fill: 'url(#' + g + '-belly)',
          }),
          // 女仆裙（黑色主体 + 白蕾丝裙摆）
          h('path', {
            d: 'M50,166 C62,148 158,148 170,166 C170,184 146,203 110,203 C74,203 50,184 50,166 Z',
            fill: '#2a3348', stroke: '#1d2436', strokeWidth: '1.6',
          }),
          h('path', {
            d: 'M50,171 q7,11 16,4 q7,12 16,5 q7,12 15,5 q7,12 16,5 q7,12 15,5 q7,11 16,2',
            stroke: '#f4f8ff', strokeWidth: '5.5', fill: 'none', strokeLinecap: 'round',
          }),
          // 围裙
          h('path', { d: 'M92,148 C104,144 118,144 129,148 L137,186 C120,193 100,193 83,186 Z', fill: '#fbfdff', stroke: '#d8e2f0', strokeWidth: '1.5' }),
          h('path', { d: 'M96,157 C108,153 118,153 127,157', stroke: '#e2ebf7', strokeWidth: '2', fill: 'none' }),
          // 领子
          h('path', { d: 'M84,124 L110,139 L95,121 Z', fill: '#f8fbff', stroke: '#d3e0f2', strokeWidth: '1.3' }),
          h('path', { d: 'M136,124 L110,139 L125,121 Z', fill: '#f8fbff', stroke: '#d3e0f2', strokeWidth: '1.3' }),
          // 蝴蝶结
          h('g', { className: 'bw-bow' },
            h('path', { d: 'M110,139 C100,131 93,135 95,142 C97,149 106,147 110,142 Z', fill: '#ff6b81', stroke: '#d94b62', strokeWidth: '1.3' }),
            h('path', { d: 'M110,139 C120,131 127,135 125,142 C123,149 114,147 110,142 Z', fill: '#ff6b81', stroke: '#d94b62', strokeWidth: '1.3' }),
            h('circle', { cx: '110', cy: '141', r: '3.6', fill: '#ffd1da', stroke: '#d94b62', strokeWidth: '1.3' }),
          ),
          // 手臂（小鳍 + 白蕾丝袖口）
          h('g', { className: 'bw-arm bw-arm-l' },
            h('path', { d: 'M46,140 C33,146 29,159 35,167 C42,158 48,152 53,150 Z', fill: '#4f8de6', stroke: '#2f62bd', strokeWidth: '2', strokeLinejoin: 'round' }),
            h('path', { d: 'M47,137 q7,8 15,6', stroke: '#f8fbff', strokeWidth: '5', fill: 'none', strokeLinecap: 'round' }),
          ),
          h('g', { className: 'bw-arm bw-arm-r' },
            h('path', { d: 'M174,140 C187,146 191,159 185,167 C178,158 172,152 167,150 Z', fill: '#4f8de6', stroke: '#2f62bd', strokeWidth: '2', strokeLinejoin: 'round' }),
            h('path', { d: 'M173,137 q-7,8 -15,6', stroke: '#f8fbff', strokeWidth: '5', fill: 'none', strokeLinecap: 'round' }),
          ),
          // 脸
          h('g', { className: 'bw-face' },
            h('ellipse', { cx: '73', cy: '110', rx: '12', ry: '7.5', fill: 'url(#' + g + '-blush)' }),
            h('ellipse', { cx: '147', cy: '110', rx: '12', ry: '7.5', fill: 'url(#' + g + '-blush)' }),
            h('g', { className: 'bw-eyes bw-eyes-calm' }, bigEye(88, 94, g), bigEye(132, 94, g)),
            h('g', { className: 'bw-eyes bw-eyes-shock' },
              h('path', { d: 'M80,88 l15,13 M95,88 l-15,13', stroke: '#1d2b45', strokeWidth: '4', strokeLinecap: 'round' }),
              h('path', { d: 'M125,88 l15,13 M140,88 l-15,13', stroke: '#1d2b45', strokeWidth: '4', strokeLinecap: 'round' }),
            ),
            h('g', { className: 'bw-eyes bw-eyes-dash' },
              h('path', { d: 'M78,96 q10,-10 21,-2', stroke: '#1d2b45', strokeWidth: '4.5', fill: 'none', strokeLinecap: 'round' }),
              h('path', { d: 'M121,96 q10,-10 21,-2', stroke: '#1d2b45', strokeWidth: '4.5', fill: 'none', strokeLinecap: 'round' }),
            ),
            h('path', { className: 'bw-mouth', d: 'M101,107 q5.5,6.5 11,0 q5.5,6.5 11,0', stroke: '#22304b', strokeWidth: '3', fill: 'none', strokeLinecap: 'round' }),
            h('ellipse', { className: 'bw-mouth-o', cx: '111', cy: '111', rx: '7', ry: '9.5', fill: '#3a2130', stroke: '#22304b', strokeWidth: '2' }),
            h('path', { className: 'bw-mouth-o', d: 'M106,114 q5,4 10,0', fill: '#ff8fa0' }),
            // 呼吸孔
            h('ellipse', { cx: '110', cy: '68', rx: '7', ry: '3.4', fill: '#2b5bb5', opacity: basinOnHead ? '.3' : '.85' }),
            // 喷的水柱（盆飞走/惊慌时）
            h('g', { className: 'bw-spout' },
              h('path', { d: 'M110,64 C103,48 95,42 90,26', stroke: '#a5dbff', strokeWidth: '5.5', fill: 'none', strokeLinecap: 'round' }),
              h('path', { d: 'M111,64 C113,46 119,40 124,22', stroke: '#a5dbff', strokeWidth: '5.5', fill: 'none', strokeLinecap: 'round' }),
              h('circle', { cx: '88', cy: '20', r: '5', fill: '#c6e7ff' }),
              h('circle', { cx: '127', cy: '16', r: '4.5', fill: '#c6e7ff' }),
              h('circle', { cx: '108', cy: '10', r: '3.5', fill: '#e2f2ff' }),
            ),
          ),
          // 女仆发箍 + 蕾丝
          h('path', { d: 'M58,78 q52,-26 104,0', stroke: '#1f2739', strokeWidth: '7', fill: 'none', strokeLinecap: 'round' }),
          h('path', {
            d: 'M56,74 q5,-14 17,-11 q4,-13 16,-10 q5,-13 17,-10 q6,-12 18,-8 q6,-11 18,-7 q6,-9 18,-5 q8,-6 16,-2',
            stroke: '#f8fbff', strokeWidth: '9.5', fill: 'none', strokeLinecap: 'round',
          }),
        ),

        // 头上的盆
        basinOnHead ? h('g', { className: 'bw-head-basin' },
          h('path', { d: 'M54,72 C54,40 69,16 110,16 C151,16 166,40 166,72 Z', fill: 'url(#' + g + '-steel)', stroke: '#454d5a', strokeWidth: '2.4', strokeLinejoin: 'round' }),
          h('path', { d: 'M74,66 C74,40 84,22 100,18', stroke: 'rgba(255,255,255,.75)', strokeWidth: '4.5', fill: 'none', strokeLinecap: 'round' }),
          h('path', { d: 'M138,63 C138,42 146,28 154,24', stroke: 'rgba(255,255,255,.42)', strokeWidth: '2.6', fill: 'none', strokeLinecap: 'round' }),
          h('path', { d: 'M66,60 C68,44 74,32 82,25', stroke: 'rgba(45,55,70,.22)', strokeWidth: '2.4', fill: 'none', strokeLinecap: 'round' }),
          h('ellipse', { cx: '110', cy: '21', rx: '15', ry: '5', fill: 'rgba(255,255,255,.3)', stroke: 'rgba(70,80,95,.45)', strokeWidth: '1.3' }),
          h('path', { d: 'M52,70 C52,83 168,83 168,70 C168,65 52,65 52,70 Z', fill: '#bcc7d4', stroke: '#454d5a', strokeWidth: '2.4', strokeLinejoin: 'round' }),
          h('path', { d: 'M59,77 C80,86 140,86 161,77', stroke: 'rgba(30,38,50,.5)', strokeWidth: '2.6', fill: 'none', strokeLinecap: 'round' }),
          h('path', { className: 'bw-sparkle', d: 'M92,32 l3.2,-8.4 l3.2,8.4 l8.4,3.2 l-8.4,3.2 l-3.2,8.4 l-3.2,-8.4 l-8.4,-3.2 Z', fill: '#ffffff' }),
        ) : null,

        // 汗滴（追/搬）
        h('g', { className: 'bw-sweat' },
          h('path', { d: 'M172,84 c7,9 7,16 0,18 c-7,-2 -7,-9 0,-18 Z', fill: '#a8ddff', stroke: '#5bb0e8', strokeWidth: '1.5' }),
          h('path', { d: 'M42,92 c7,9 7,16 0,18 c-7,-2 -7,-9 0,-18 Z', fill: '#a8ddff', stroke: '#5bb0e8', strokeWidth: '1.5' }),
        ),
        // 眼冒金星（被敲时）
        h('g', { className: 'bw-dizzy' },
          h('path', { d: 'M150,52 l3.6,7.4 l7.4,3.6 l-7.4,3.6 l-3.6,7.4 l-3.6,-7.4 l-7.4,-3.6 l7.4,-3.6 Z', fill: '#ffd166' }),
          h('path', { d: 'M62,44 l2.8,5.6 l5.6,2.8 l-5.6,2.8 l-2.8,5.6 l-2.8,-5.6 l-5.6,-2.8 l5.6,-2.8 Z', fill: '#ffe08a' }),
        ),
        // 捡起时手上托的盆（carry 阶段由飞行层画，这里只画双手上抬）
      )
    }

    function bigEye(cx, cy, g) {
      return h('g', { className: 'bw-blink' },
        h('ellipse', { cx, cy, rx: '9', ry: '11.5', fill: '#22304b' }),
        h('ellipse', { cx: cx + 3, cy: cy - 4.5, rx: '3.2', ry: '3.9', fill: '#ffffff' }),
        h('ellipse', { cx: cx - 2.4, cy: cy + 4.6, rx: '1.9', ry: '2.1', fill: 'rgba(255,255,255,.8)' }),
      )
    }

    // ======================================================================
    // 峰谷 24 小时条带（北京时间小时，宿主机与本浏览器同区时差直接对齐本地钟点）
    // ======================================================================
    function PeakBar({ data, t }) {
      const seg = (data && data.segments) || []
      if (!seg.length) return null
      const nowSec = (data && data.nowSec) || Math.floor(Date.now() / 1000)
      const dayStart = typeof data.dayStartSec === 'number' ? data.dayStartSec : nowSec - (nowSec % 86400)
      const hourNow = clamp((nowSec - dayStart) / 3600, 0, 24)
      const cells = []
      for (let i = 0; i < seg.length; i++) {
        const start = seg[i].hour
        const end = i + 1 < seg.length ? seg[i + 1].hour : 24
        cells.push(h('div', {
          key: i, className: 'bw-bar-cell ' + (seg[i].peak ? 'is-peak' : 'is-valley'),
          style: { flexGrow: end - start, flexBasis: 0 },
          title: start + ':00–' + end + ':00 ' + t(seg[i].peak ? 'peak' : 'valley'),
        }, String(start).padStart(2, '0')))
      }
      return h('div', { className: 'bw-bar', title: t('peakHint') },
        h('div', { className: 'bw-bar-track' }, cells),
        h('div', { className: 'bw-bar-now', style: { left: (hourNow / 24 * 100) + '%' } }),
      )
    }

    // ======================================================================
    // 音效：金属撞击（击飞）/ 归位叮（纯 WebAudio 合成，不加载任何资源文件）
    // ======================================================================
    function useSfx() {
      const ref = useRef(null)
      const onRef = useRef(true)
      useEffect(() => () => { try { ref.current && ref.current.close() } catch (err) {} }, [])
      const ac = () => {
        if (!onRef.current) return null
        try {
          const AC = window.AudioContext || window.webkitAudioContext
          if (!AC) return null
          if (!ref.current) ref.current = new AC()
          if (ref.current.state === 'suspended') ref.current.resume().catch(() => {})
          return ref.current
        } catch (err) { return null }
      }
      const clang = useCallback(() => {
        const c = ac(); if (!c) return
        try {
          const dur = 0.55
          const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate)
          const ch = buf.getChannelData(0)
          for (let i = 0; i < ch.length; i++) {
            const tt = i / c.sampleRate
            const env = Math.exp(-tt * 11)
            ch[i] = env * (Math.sin(6.283 * 1974 * tt) * 0.5 + Math.sin(6.283 * 2640 * tt) * 0.3
              + Math.sin(6.283 * 4120 * tt) * 0.17 + (Math.random() * 2 - 1) * 0.2)
          }
          const src = c.createBufferSource(); src.buffer = buf
          const gain = c.createGain(); gain.gain.value = 0.2
          src.connect(gain).connect(c.destination); src.start()
        } catch (err) {}
      }, [])
      const pop = useCallback(() => {
        const c = ac(); if (!c) return
        try {
          const o = c.createOscillator(), g = c.createGain()
          o.type = 'sine'
          o.frequency.setValueAtTime(440, c.currentTime)
          o.frequency.exponentialRampToValueAtTime(1180, c.currentTime + 0.12)
          g.gain.setValueAtTime(0.0008, c.currentTime)
          g.gain.exponentialRampToValueAtTime(0.14, c.currentTime + 0.02)
          g.gain.exponentialRampToValueAtTime(0.0008, c.currentTime + 0.3)
          o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + 0.32)
        } catch (err) {}
      }, [])
      const scurry = useCallback(() => {
        const c = ac(); if (!c) return
        try {
          const dur = 0.4
          const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate)
          const ch = buf.getChannelData(0)
          for (let i = 0; i < ch.length; i++) {
            const tt = i / c.sampleRate
            ch[i] = Math.exp(-tt * 7) * (Math.random() * 2 - 1) * 0.4 * (0.5 + 0.5 * Math.sin(tt * 90))
          }
          const src = c.createBufferSource(); src.buffer = buf
          const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.8
          const gain = c.createGain(); gain.gain.value = 0.09
          src.connect(bp).connect(gain).connect(c.destination); src.start()
        } catch (err) {}
      }, [])
      return useMemo(() => ({
        clang, pop, scurry,
        setEnabled: (v) => { onRef.current = !!v },
      }), [clang, pop, scurry])
    }

    // ======================================================================
    // 主组件
    // ======================================================================
    const IDLE = 'idle', KNOCKED = 'knocked', CHASE = 'chase', PICKUP = 'pickup', CARRY = 'carry', HAPPY = 'happy'
    // 舞台几何：舞台 300×300。鲸鱼娘 svg（viewBox 220×230，与 px 严格 1:1）贴底放在 left=40，
    // 顶部留 70px 空场给「被击飞的盆」和泡泡，左右各 40px 给跑动余量。
    const STAGE_W = 300, STAGE_H = 300
    const WHALE_X = 40, WHALE_W = 220, WHALE_H = 230
    const SVG_Y0 = STAGE_H - WHALE_H                 // svg 顶在舞台里的 y = 70
    const HEAD = { x: WHALE_X + 110, y: SVG_Y0 + 50 } // 头上盆的视觉中心（svg 盆体跨 y 16..83）
    // 盆体在飞行 svg（viewBox 120×78）里正好居中，所以 translate 到 (x,y) 就是盆体中心。
    const BASIN_BODY_W = 116, BASIN_BODY_H = 65
    const FLOOR_Y = STAGE_H - 46   // 盆落地时的中心 y ⇒ 盆底正好压在影子线上（svg y=214）
    const TOP_Y = 42               // 撞舞台顶软弹回，不会糊到信息面板上
    const FLY_W = Math.round(BASIN_BODY_W * 120 / 96) // = 145：与头上那只盆等大，交接才不跳尺寸
    const FLY_H = Math.round(FLY_W * 78 / 120)        // = 94
    const BASIN_MIN = BASIN_BODY_W / 2 + 2, BASIN_MAX = STAGE_W - BASIN_BODY_W / 2 - 2

    function Pet({ lang }) {
      const t = useCallback((k) => (TEXT[lang] && TEXT[lang][k]) || TEXT.zh[k] || k, [lang])
      const uid = useMemo(() => 'u' + Math.random().toString(36).slice(2, 8), [])
      const sfx = useSfx()

      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [phase, setPhase] = useState(IDLE)
      const [bubble, setBubble] = useState(null)
      const [pos, setPos] = useState(() => loadPos())
      const [panelOpen, setPanelOpen] = useState(() => readJson(PREF_STORE, {}).panelOpen !== false)
      const [soundOn, setSoundOn] = useState(() => readJson(PREF_STORE, {}).sound !== false)
      const [now, setNow] = useState(() => Math.floor(Date.now() / 1000) - 1) // 首帧与宿主 nowSec 对齐，避免 1s 跳动

      const stageRef = useRef(null)
      const flyRef = useRef(null)
      const runnerRef = useRef(null)
      const bubbleTimer = useRef(0)
      const busyRef = useRef(false)
      const animRef = useRef(null)
      const posRef = useRef(pos)
      posRef.current = pos

      // 盆飞行状态（只在动画里读写，不进 React state）
      const basinRef = useRef(null)
      // 拖拽相关（在 knock / click* 里只读，声明放前面保持可读）
      const dragRef = useRef(null)
      const lastDragAt = useRef(0)
      const movedRef = useRef(false)
      const handlersRef = useRef(null)

      useEffect(() => { sfx.setEnabled(soundOn) }, [soundOn, sfx])
      useEffect(() => () => {
        if (animRef.current) animRef.current.cancel()
        clearTimeout(bubbleTimer.current)
      }, [])

      const say = useCallback((text, ms) => {
        clearTimeout(bubbleTimer.current)
        setBubble(text)
        bubbleTimer.current = setTimeout(() => setBubble(null), ms || 2600)
      }, [])

      // —— 取数 ——
      const pull = useCallback((force) => {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 25000)
        fetch(API + (force ? '?refresh=1' : ''), { credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: ctrl.signal })
          .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
          .then((json) => {
            setData(json)
            setError(json && json.ok ? '' : String((json && (json.error || json.code)) || t('needAuth')))
            if (json && Number.isFinite(json.nowSec)) setNow(json.nowSec) // 倒计时与条带对齐宿主时钟
          })
          .catch((e) => setError(String((e && e.message) || e)))
          .finally(() => clearTimeout(timer))
      }, [t])

      useEffect(() => { pull(false); const id = setInterval(() => pull(false), REFRESH_MS); return () => clearInterval(id) }, [pull])

      // 1 秒心跳：倒计时 + 峰谷条带跟着走
      useEffect(() => {
        const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
        return () => clearInterval(id)
      }, [])

      // 峰谷切换点：过点后强制重取一次（条带与状态由宿主算）
      const nextSwitch = data && data.nextSwitchAt
      useEffect(() => {
        if (!nextSwitch) return
        const ms = nextSwitch * 1000 - Date.now() + 1200
        if (ms <= 0 || ms > 26 * 3600 * 1000) return
        const id = setTimeout(() => pull(true), ms)
        return () => clearTimeout(id)
      }, [nextSwitch, pull])

      // —— 盆的位置写入（不触发 re-render）——
      const setFly = useCallback((x, y, rot) => {
        const el = flyRef.current
        if (!el) return
        el.style.transform = 'translate3d(' + (x - HEAD.x) + 'px,' + (y - HEAD.y) + 'px,0) rotate(' + rot + 'deg)'
      }, [])
      const setRunner = useCallback((x) => {
        const el = runnerRef.current
        if (el) el.style.transform = 'translate3d(' + x + 'px,0,0)'
      }, [])

      // ======================================================================
      // 击飞 → 追 → 捡 → 归位（一条异步序列，可随时被打断重放）
      // ======================================================================
      const knock = useCallback((event) => {
        event.stopPropagation()
        if (busyRef.current) return
        if (Date.now() - lastDragAt.current < 350 || movedRef.current) return
        busyRef.current = true
        if (animRef.current) animRef.current.cancel()
        const A = makeAnimator()
        animRef.current = A

        const rect = stageRef.current ? stageRef.current.getBoundingClientRect() : { left: 0, top: 0, width: STAGE_W }
        const scale = rect.width ? STAGE_W / rect.width : 1
        const px = (event.clientX - rect.left) * scale
        const dir = px < HEAD.x ? -1 : 1
        const power = 0.72 + Math.random() * 0.62

        setPhase(KNOCKED)
        sfx.clang()
        say(pick(TEXT[lang].knocked), 1500)

        const b = {
          x: HEAD.x, y: HEAD.y, rot: 0,
          vx: dir * (240 + 210 * power) * (0.7 + Math.random() * 0.6),
          vy: -(300 + 220 * power),
          vr: dir * (7 + 8 * power),
          settled: false,
        }
        basinRef.current = b

        // 阶段 1：抛物线 + 撞边/撞顶 + 落地弹跳翻滚，直到基本停住
        const GRAV = 1500
        let last = performance.now()
        let elapsed = 0
        const phys = () => new Promise((resolve) => {
          const step = (now2) => {
            if (!A.alive.current) return resolve(false)
            const dt = Math.min(0.033, (now2 - last) / 1000)
            last = now2
            elapsed += dt * 1000
            b.vy += GRAV * dt
            b.x += b.vx * dt
            b.y += b.vy * dt
            b.rot += b.vr * dt * 57.3
            if (b.x < BASIN_MIN) { b.x = BASIN_MIN; b.vx = Math.abs(b.vx) * 0.72; b.vr = Math.abs(b.vr) * 0.6 }
            if (b.x > BASIN_MAX) { b.x = BASIN_MAX; b.vx = -Math.abs(b.vx) * 0.72; b.vr = -Math.abs(b.vr) * 0.6 }
            if (b.y < TOP_Y) { b.y = TOP_Y; b.vy = Math.abs(b.vy) * 0.45 }
            if (b.y >= FLOOR_Y) {
              b.y = FLOOR_Y
              if (Math.abs(b.vy) > 120) { b.vy = -Math.abs(b.vy) * 0.42; b.vx *= 0.82; b.vr = b.vr * 0.55 + b.vx * 0.02 }
              else {
                b.vy = 0
                b.vx *= Math.max(0, 1 - 2.6 * dt)
                b.vr *= Math.max(0, 1 - 2.4 * dt)
                b.rot += b.vx * dt * 1.1
                if (Math.abs(b.vx) < 26 && elapsed > 620) b.settled = true
              }
            }
            setFly(b.x, b.y, b.rot)
            if (b.settled) return resolve(true)
            if (elapsed > 3600) return resolve(true)
            requestAnimationFrame(step)
          }
          requestAnimationFrame(step)
        })

        ;(async () => {
          const ok1 = await phys()
          if (!ok1) { reset(); return }
          const landedX = clamp(b.x, BASIN_MIN, BASIN_MAX)

          // 阶段 2：跑过去（约 320 px/s，蹲/起身各留一点时间）
          setPhase(CHASE)
          sfx.scurry()
          say(pick(TEXT[lang].chase), 1600)
          const dx = landedX - HEAD.x
          const dur = clamp(Math.abs(dx) / 0.32, 320, 1400)
          if (!(await A.tween(dur, (p) => setRunner(dx * easeInOut(p))))) { reset(); return }

          // 阶段 3：蹲下捡起
          setPhase(PICKUP)
          if (!(await A.wait(500))) { reset(); return }

          // 阶段 4：人抱着盆走回原位，盆同时划弧归位（两段同长度 ⇒ 同时到位，不会悬空等）
          setPhase(CARRY)
          const backX = dx
          const sx = b.x, sy = b.y, srot = b.rot
          const durBack = clamp(Math.abs(backX) / 0.36, 380, 1200)
          const both = await Promise.all([
            A.tween(durBack, (p) => {
              const e = easeOut(p)
              setFly(sx + (HEAD.x - sx) * e, sy + (HEAD.y - sy) * e - Math.sin(Math.PI * p) * 70, srot * (1 - e))
            }),
            A.tween(durBack, (p) => setRunner(backX * (1 - easeInOut(p)))),
          ])
          if (both.some((v) => !v)) { reset(); return }

          // 阶段 5：扣好，开心两跳
          setPhase(HAPPY)
          sfx.pop()
          say(pick(TEXT[lang].pickup), 2400)
          await A.wait(1300)
          reset()

          function reset() {
            basinRef.current = null
            const fe = flyRef.current
            if (fe) fe.style.transform = ''
            setRunner(0)
            setPhase(IDLE)
            busyRef.current = false
            animRef.current = null
          }
        })()
      }, [lang, say, setFly, setRunner, sfx])

      // —— 点鲸鱼娘：刷新 + 吐槽 ——
      const clickWhale = useCallback((e) => {
        e.stopPropagation()
        if (busyRef.current || Date.now() - lastDragAt.current < 350) return
        pull(true)
        say(pick(TEXT[lang].poke), 2900)
      }, [lang, pull, say])

      const clickBasin = useCallback((e) => {
        e.stopPropagation()
        if (Date.now() - lastDragAt.current < 350) return
        knock(e)
      }, [knock])

      // —— 拖拽摆放：window 级监听（不用 setPointerCapture —— 它会改变 click 的目标元素，
      //    把盆按钮 / 鲸鱼的 onClick 打掉）；位移阈值区分「点按」与「拖拽」。
      //    处理器只建一次（身份稳定，removeEventListener 才拆得掉）。 ——
      if (!handlersRef.current) {
        const onMove = (e) => {
          const d = dragRef.current
          if (!d) return
          if (!movedRef.current && Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) < 7) return
          movedRef.current = true
          const w = STAGE_W + 20, hgt = STAGE_H + 70
          const x = clamp(e.clientX - d.ox, 4, Math.max(4, window.innerWidth - w))
          const y = clamp(e.clientY - d.oy, 4, Math.max(4, window.innerHeight - hgt))
          setPos({ mode: 'tl', x, y })
        }
        const onUp = () => {
          const d = dragRef.current
          dragRef.current = null
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onUp)
          if (d && movedRef.current) {
            lastDragAt.current = Date.now()
            writeJson(POS_STORE, posRef.current)
          }
        }
        handlersRef.current = { onMove, onUp }
      }
      useEffect(() => () => {
        const H = handlersRef.current
        if (!H) return
        window.removeEventListener('pointermove', H.onMove)
        window.removeEventListener('pointerup', H.onUp)
        window.removeEventListener('pointercancel', H.onUp)
      }, [])

      const onPointerDown = useCallback((e) => {
        if (typeof e.button === 'number' && e.button !== 0) return
        try {
          if (e.target && e.target.closest && (e.target.closest('.bw-panel') || e.target.closest('.bw-mini'))) return
        } catch (err) {}
        const r = e.currentTarget.getBoundingClientRect()
        dragRef.current = { ox: e.clientX - r.left, oy: e.clientY - r.top, sx: e.clientX, sy: e.clientY }
        movedRef.current = false
        const H = handlersRef.current
        window.addEventListener('pointermove', H.onMove)
        window.addEventListener('pointerup', H.onUp)
        window.addEventListener('pointercancel', H.onUp)
      }, [])

      const style = useMemo(() => Object.assign(
        // 左下角摆放时面板跟着左对齐，别飘到右边
        pos.mode === 'lb' ? { left: pos.x, bottom: pos.y, alignItems: 'flex-start' }
          : pos.mode === 'rb' ? { right: pos.x, bottom: pos.y }
            : { left: pos.x, top: pos.y },
        { width: STAGE_W }), [pos])

      // 窗口缩小/移动后别让宠物掉到视口外
      useEffect(() => {
        const keepInside = () => {
          const p = posRef.current
          if (p.mode !== 'tl') return
          const w = STAGE_W + 20, hgt = STAGE_H + 70
          const x = clamp(p.x, 4, Math.max(4, window.innerWidth - w))
          const y = clamp(p.y, 4, Math.max(4, window.innerHeight - hgt))
          if (x !== p.x || y !== p.y) setPos({ mode: 'tl', x, y })
        }
        window.addEventListener('resize', keepInside)
        return () => window.removeEventListener('resize', keepInside)
      }, [])

      const peak = !!(data && data.peak)
      const hasBalance = !!(data && data.ok && typeof data.balance === 'number')
      const secLeft = nextSwitch ? nextSwitch - now : NaN
      const flyVisible = phase === KNOCKED || phase === CHASE || phase === PICKUP || phase === CARRY
      const basinOnHead = phase === IDLE || phase === HAPPY
      const errText = error && !(data && data.ok) ? String(error).slice(0, 170) : ''

      return h('div', {
        className: 'bw-root', style,
        onPointerDown,
      },
        h('style', null, CSS),

        // —— 信息面板 ——
        h('div', { className: 'bw-panel' + (panelOpen ? '' : ' is-collapsed') },
          h('div', { className: 'bw-panel-head' },
            h('span', { className: 'bw-dot ' + (hasBalance ? 'is-ok' : 'is-bad') }),
            h('span', { className: 'bw-panel-title' }, t('title')),
            h('button', {
              type: 'button', className: 'bw-mini', title: soundOn ? t('mute') : t('unmute'), 'aria-pressed': soundOn,
              onClick: () => setSoundOn((v) => { writeJson(PREF_STORE, Object.assign(readJson(PREF_STORE, {}), { sound: !v })); return !v }) }, '♪'),
            h('button', {
              type: 'button', className: 'bw-mini', title: panelOpen ? t('hidePanel') : t('showPanel'), 'aria-expanded': panelOpen,
              onClick: () => setPanelOpen((v) => { writeJson(PREF_STORE, Object.assign(readJson(PREF_STORE, {}), { panelOpen: !v })); return !v }) }, panelOpen ? '▾' : '▴'),
          ),
          panelOpen ? h('div', { className: 'bw-panel-body' },
            h('div', { className: 'bw-money' },
              h('span', { className: 'bw-money-label' }, t('balance')),
              h('span', { className: 'bw-money-value' + (hasBalance ? '' : ' is-bad') },
                hasBalance ? symbolOf(data.currency) + money(data.balance) : t('noBalance'))),
            row(t('today'), hasBalance || (data && data.todayUsed != null) ? symbolOf(data.currency) + money(data.todayUsed) : '—',
              data && data.todayCredits ? '入 ' + money(data.todayCredits) : ''),
            row(t('bonus'), symbolOf(data && data.currency) + money(data && data.bonus),
              data && data.balanceSource ? (data.balanceSource === 'account' ? (lang === 'en' ? 'via account' : '账号登录') : (lang === 'en' ? 'via API key' : 'API key')) : ''),
            row(t('recharge'), symbolOf(data && data.currency) + money(data && data.recharge), ''),
            h('div', { className: 'bw-tier ' + (peak ? 'is-peak' : 'is-valley') },
              h('span', { className: 'bw-tier-badge' }, peak ? 'PEAK' : 'OFF-PEAK'),
              h('span', { className: 'bw-tier-text' }, t(peak ? 'peak' : 'valley')),
              h('span', { className: 'bw-tier-left' }, t('nextSwitch') + ' ' + fmtCountdown(secLeft))),
            h(PeakBar, { data, t }),
            errText ? h('div', { className: 'bw-err' }, errText)
              : (data && data.stale ? h('div', { className: 'bw-err' }, t('stale')) : null),
            h('a', { className: 'bw-link', href: 'https://platform.deepseek.com/top_up', target: '_blank', rel: 'noreferrer' }, t('link')),
          ) : null,
        ),

        // —— 舞台 ——
        h('div', { className: 'bw-stage', ref: stageRef, role: 'group', 'aria-label': t('aria') },
          h('div', { className: 'bw-runner is-' + phase, ref: runnerRef, onClick: clickWhale, title: t('title') },
            h(Whale, { uid, phase, basinOnHead })),
          h('div', {
            className: 'bw-fly', ref: flyRef, 'aria-hidden': 'true',
            style: { visibility: flyVisible ? 'visible' : 'hidden' },
          }, h(Basin, { uid: uid + 'f', size: FLY_W })),
          basinOnHead ? h('button', {
            type: 'button', className: 'bw-basin-hit', title: t('aria'), 'aria-label': t('aria'),
            onClick: clickBasin,
          }) : null,
          bubble ? h('div', { className: 'bw-bubble', role: 'status' }, bubble) : null,
        ),
      )

      function row(label, value, tail) {
        return h('div', { className: 'bw-row' },
          h('span', null, label), h('b', null, value), tail ? h('i', null, tail) : null)
      }
    }

    function symbolOf(currency) {
      const c = String(currency || 'CNY').toUpperCase()
      return c === 'USD' ? '$' : c === 'CNY' ? '¥' : c + ' '
    }

    function loadPos() {
      const p = readJson(POS_STORE, null)
      const vw = Math.max(320, window.innerWidth), vh = Math.max(320, window.innerHeight)
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        if (p.mode === 'rb' || p.mode === 'lb') return { mode: p.mode, x: clamp(p.x, 6, vw - 60), y: clamp(p.y, 6, vh - 60) }
        if (p.mode === 'tl') return { mode: 'tl', x: clamp(p.x, 0, vw - 120), y: clamp(p.y, 0, vh - 120) }
      }
      // 默认左下角：本 profile 已装了 dsh-whale-widget（默认右下角），错开不挡它
      return { mode: 'lb', x: 24, y: 96 }
    }

    // ======================================================================
    // 样式：容器/控件全部用宿主 theme token；美术（鲸鱼/盆）自用颜色
    // ======================================================================
    const CSS = `
.bw-root{position:fixed;z-index:20;display:flex;flex-direction:column;align-items:flex-end;gap:6px;
  font-size:12px;line-height:1.45;color:var(--dsw-alias-label-primary);pointer-events:none;
  -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;touch-action:none}
.bw-panel{width:198px;box-sizing:border-box;border-radius:12px;padding:8px 10px;
  background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);
  box-shadow:0 8px 24px rgba(10,20,40,.18);pointer-events:auto;overflow:hidden}
.bw-panel.is-collapsed{width:158px;padding:5px 8px}
.bw-panel-head{display:flex;align-items:center;gap:6px;margin-bottom:6px}
.bw-panel.is-collapsed .bw-panel-head{margin-bottom:0}
.bw-panel-title{flex:1;font-weight:600;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bw-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-state-success-primary)}
.bw-dot.is-bad{background:var(--dsw-alias-state-error-primary)}
.bw-mini{flex:none;width:20px;height:20px;border-radius:6px;cursor:pointer;font-size:11px;padding:0;
  border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);
  display:inline-flex;align-items:center;justify-content:center}
.bw-mini:hover{background:var(--dsw-alias-bg-layer-2)}
.bw-money{display:flex;align-items:baseline;justify-content:space-between;gap:6px;margin-bottom:4px}
.bw-money-label{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.bw-money-value{font-size:17px;font-weight:700;font-variant-numeric:tabular-nums}
.bw-money-value.is-bad{color:var(--dsw-alias-state-error-primary);font-size:12px;font-weight:600}
.bw-row{display:flex;align-items:baseline;gap:5px;font-size:11px;margin:1.5px 0;
  color:var(--dsw-alias-label-secondary)}
.bw-row b{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;margin-left:auto}
.bw-row i{font-style:normal;font-size:9.5px;opacity:.7;white-space:nowrap}
.bw-tier{display:flex;align-items:center;gap:6px;margin:7px 0 4px;padding:4px 6px;border-radius:8px;font-size:11px}
.bw-tier.is-valley{background:rgba(47,162,76,.16);color:#1c7d3c}
.bw-tier.is-peak{background:rgba(224,67,63,.16);color:#c3302c}
.bw-tier-badge{font-size:8.5px;font-weight:800;letter-spacing:.4px;opacity:.8}
.bw-tier-text{font-weight:700;flex:1;white-space:nowrap}
.bw-tier-left{font-variant-numeric:tabular-nums;opacity:.85;white-space:nowrap}
.bw-bar{position:relative;height:15px;border-radius:5px;overflow:hidden;border:1px solid var(--dsw-alias-border-l1)}
.bw-bar-track{display:flex;height:100%}
.bw-bar-cell{display:flex;align-items:center;justify-content:center;font-size:8px;color:rgba(255,255,255,.9);min-width:0}
.bw-bar-cell.is-peak{background:linear-gradient(180deg,#ef6b66,#d33e39)}
.bw-bar-cell.is-valley{background:linear-gradient(180deg,#48b56a,#2fa24c)}
.bw-bar-now{position:absolute;top:-1px;bottom:-1px;width:2px;background:var(--dsw-alias-label-primary);
  box-shadow:0 0 0 1px rgba(255,255,255,.65)}
.bw-err{margin-top:5px;font-size:9.5px;line-height:1.35;color:var(--dsw-alias-state-error-primary);word-break:break-all}
.bw-link{display:inline-block;margin-top:5px;font-size:10.5px;color:var(--dsw-alias-brand-primary);text-decoration:none}
.bw-link:hover{text-decoration:underline}
.bw-stage{position:relative;width:${STAGE_W}px;height:${STAGE_H}px;pointer-events:none;cursor:grab;overflow:visible;flex:none;touch-action:none}
.bw-stage:active{cursor:grabbing}
.bw-runner{position:absolute;left:${WHALE_X}px;bottom:0;width:${WHALE_W}px;height:${WHALE_H}px;will-change:transform;pointer-events:auto;touch-action:none}
.bw-fly{position:absolute;left:0;top:0;width:${FLY_W}px;height:${FLY_H}px;
  margin-left:${HEAD.x - FLY_W / 2}px;margin-top:${HEAD.y - FLY_H / 2}px;
  pointer-events:none;will-change:transform;z-index:2}
.bw-fly svg{display:block}
.bw-basin-hit{position:absolute;left:${HEAD.x - 68}px;top:${HEAD.y - 32}px;width:136px;height:62px;
  border:0;padding:0;margin:0;background:transparent;cursor:pointer;pointer-events:auto;
  border-radius:50% 50% 45% 45%;z-index:3}
.bw-basin-hit:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.bw-bubble{position:absolute;left:0;right:0;top:2px;width:max-content;max-width:210px;margin:0 auto;
  padding:6px 9px;border-radius:12px 12px 12px 3px;
  background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);
  color:var(--dsw-alias-label-primary);font-size:11.5px;pointer-events:none;z-index:4;
  box-shadow:0 6px 16px rgba(10,20,40,.2);animation:bw-pop .18s ease-out}
@keyframes bw-pop{from{transform:scale(.72);opacity:0}to{transform:scale(1);opacity:1}}
/* 待机呼吸 / 眨眼 / 盆晃 / 反光 */
.bw-body{animation:bw-breathe 3.6s ease-in-out infinite;transform-box:fill-box;transform-origin:50% 92%}
@keyframes bw-breathe{0%,100%{transform:scale(1,1)}50%{transform:scale(1.014,.988) translateY(-2px)}}
.bw-head-basin{animation:bw-wobble 4.8s ease-in-out infinite;transform-box:fill-box;transform-origin:50% 88%}
@keyframes bw-wobble{0%,100%{transform:rotate(-1.4deg)}50%{transform:rotate(1.5deg)}}
.bw-blink{animation:bw-blink 5.4s infinite;transform-box:fill-box;transform-origin:center}
@keyframes bw-blink{0%,92%,100%{transform:scaleY(1)}95%,97%{transform:scaleY(.1)}}
.bw-sparkle{animation:bw-spark 3.4s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
@keyframes bw-spark{0%,72%,100%{opacity:0;transform:scale(.5)}80%{opacity:1;transform:scale(1.15)}}
.bw-shadow{animation:bw-shad 3.6s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
@keyframes bw-shad{0%,100%{transform:scaleX(1)}50%{transform:scaleX(.93)}}
.bw-tail{animation:bw-tail 2.6s ease-in-out infinite;transform-box:fill-box;transform-origin:12% 30%}
@keyframes bw-tail{0%,100%{transform:rotate(-6deg)}50%{transform:rotate(7deg)}}
/* 眼睛/嘴：默认平静 */
.bw-eyes,.bw-mouth,.bw-mouth-o,.bw-spout,.bw-sweat,.bw-dizzy{transform-box:fill-box}
.bw-eyes-shock,.bw-eyes-dash,.bw-mouth-o,.bw-spout,.bw-sweat,.bw-dizzy{display:none}
.is-knocked .bw-eyes-calm,.is-chase .bw-eyes-calm,.is-pickup .bw-eyes-calm,.is-carry .bw-eyes-calm{display:none}
.is-knocked .bw-eyes-shock{display:block}
.is-knocked .bw-mouth{display:none}
.is-knocked .bw-mouth-o{display:block}
.is-knocked .bw-spout{display:block;animation:bw-spray .42s ease-in-out infinite alternate}
.is-knocked .bw-dizzy{display:block;animation:bw-spin 1.2s linear infinite}
@keyframes bw-spray{from{opacity:.55;transform:translateY(3px) scale(.95)}to{opacity:1;transform:translateY(-5px) scale(1.05)}}
@keyframes bw-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
.is-knocked .bw-body,.is-chase .bw-body{animation:bw-waddle .3s linear infinite;transform-origin:50% 96%}
@keyframes bw-waddle{0%,100%{transform:rotate(-5deg) translateY(-1px)}50%{transform:rotate(5deg) translateY(-4px)}}
.is-chase .bw-eyes-dash,.is-pickup .bw-eyes-dash,.is-carry .bw-eyes-dash{display:block}
.is-chase .bw-sweat{display:block;animation:bw-sweat .45s linear infinite}
.is-carry .bw-sweat{display:block;animation:bw-sweat .6s linear infinite}
@keyframes bw-sweat{0%{opacity:.95;transform:translateY(-2px)}100%{opacity:0;transform:translateY(15px)}}
.is-chase .bw-arm{animation:bw-flail .3s linear infinite;transform-box:fill-box;transform-origin:80% 10%}
@keyframes bw-flail{0%,100%{transform:rotate(-16deg)}50%{transform:rotate(16deg)}}
.is-pickup .bw-body{animation:bw-squat .4s ease-in-out infinite alternate;transform-origin:50% 100%}
@keyframes bw-squat{from{transform:translateY(0) scale(1,1)}to{transform:translateY(7px) scale(1.07,.9)}}
.is-carry .bw-body{animation:bw-lift .5s ease-in-out infinite alternate;transform-origin:50% 100%}
@keyframes bw-lift{from{transform:translateY(2px) scale(1,1)}to{transform:translateY(-3px) scale(.99,1.02)}}
.is-happy .bw-body{animation:bw-hop .42s ease-out 3;transform-origin:50% 100%}
@keyframes bw-hop{0%,100%{transform:translateY(0)}45%{transform:translateY(-11px)}}
@media (prefers-reduced-motion:reduce){.bw-root *{animation:none !important}}
`

    // ======================================================================
    // 注册到整框浮层
    // ======================================================================
    return {
      inject: ['slots'],
      apply(ctx) {
        const lang = (() => {
          try {
            const svc = typeof ctx.get === 'function' ? ctx.get('locale') : null
            const snap = svc && (typeof svc.getSnapshot === 'function' ? svc.getSnapshot()
              : typeof svc.getLocale === 'function' ? svc.getLocale() : null)
            const id = snap && ((snap.active && snap.active.id) || snap.id || snap.locale || snap.language)
            if (typeof id === 'string' && /^en/i.test(id)) return 'en'
          } catch (err) {}
          try { if (/^en/i.test(navigator.language || '')) return 'en' } catch (err) {}
          return 'zh'
        })()
        return ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'dsh-basin-whale-pet', order: 96, label: TEXT[lang].title,
        }, () => h(Pet, { lang })))
      },
    }
  },
})
