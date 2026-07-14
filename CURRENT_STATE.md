# CURRENT_STATE - Cuefield transition hardening
> 更新时间: 2026-07-15 | 线程: 反馈小修与全功能红蓝对抗

## 目标
- 让规划时间和实际执行位置一致，并避开歌曲文件末尾的无声区域。

## 已做
- terminal rescue 从能量窗口识别 `effectiveSourceEnd`；仅裁掉至少 2.2 秒的连续零能量尾部，正常弱尾奏不裁。
- USA Today -> Believe In Me 真实计划：235.23 秒开始、239.171 秒后淡出 A、240 秒交接，不再进入 245.705 秒文件尾静音。
- 开始时间向后取毫秒、可用时长向下取毫秒；10 万组随机规划无提前切、越界交接或时间线超窗。
- 最低收听时间前移到规划请求，写入 `protectedUntil`；不再先选早切点、再由播放器事后硬拖到陌生旋律位置。
- `effectiveSourceEnd` 已透传 API、浏览器反馈、本地/远端反馈记录。
- 红队复查封面/音频身份锁、未缓存预载、智能 10-20 选歌、DJ 操作执行和反馈契约，未发现其他可复现回归。
- 全量 397 tests、语法、diff、HTTP、Playwright 与真实缓存 API 验证通过；本地运行于 `http://127.0.0.1:3000`。

## 未做 / 下一步
- 用户复听 USA Today -> Believe In Me 及普通结构过渡，重点确认尾部淡出和新切点是否自然。

## 关键约束 / 红线
- 保留已认可的 A/B 参数；不凭空重调。保留 `desktop/main.js` 用户 Metal edit，不提交。

## 关键路径 / 文件
- `cuefield/transition-window-planner.js`, `cuefield/mineradio-bridge.js`, `public/cuefield-automix.js`, `public/index.html`
