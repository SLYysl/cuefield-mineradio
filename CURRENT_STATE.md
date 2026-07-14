# CURRENT_STATE - Cuefield adaptive terminal rescue
> 更新时间: 2026-07-14 | 线程: A/B/C 保底过渡执行分型

## 目标
- 不再让所有 terminal-rescue 共用同一条回声/EQ 时间线；按失败原因执行不同的过渡。

## 已做
- A 人声冲突：最终窗口仍有人声时，先用 720ms equal-power 退出 A，再让 B 浮现，取消回声和滤波。
- B 能量差异：依据原 route 的 snap/energy contrast 信号，分三段恢复 B 的高通和低频；A 低频只缓降到 0.72。
- C 可用时间窗不足：无回声、无 EQ 戏法，只做 3.4 秒 clean equal-power crossfade。
- 保留可信 Hook/Drop 预滚与落点约束；真实样本 Bubble Gum -> Riot Call、Killing Me -> Fortress、USA Today -> Believe In Me 分别命中 A/B/C。
- API、播放器评分上下文、本地/远端反馈记录均透传 `terminalRescueClass` 和原因。
- 三段 14.4 秒试听输出在 `/tmp/cuefield-previews/`；切换发生在第 5 秒。
- 完整测试、syntax、diff check、HTTP/API 真实计划验证通过。

## 未做 / 下一步
- 用户试听 A/B/C 样本并分别评分；根据听感优先微调 A 的退出间隔和 B 的三段 EQ 斜率。

## 关键约束 / 红线
- A 优先级高于 B；C 不能因“曾等待过歌词”误判为 A。
- 保留 `desktop/main.js` 的用户本地 Metal edit；不得提交。

## 关键路径 / 文件
- `cuefield/transition-window-planner.js`, `cuefield/mineradio-bridge.js`, `cuefield/feedback-log.js`, `public/index.html`
