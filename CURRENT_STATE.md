# CURRENT_STATE - Cuefield adaptive terminal rescue
> 更新时间: 2026-07-14 | 线程: A/B/C 首轮反馈修正

## 目标
- 不再让所有 terminal-rescue 共用同一条回声/EQ 时间线；按失败原因执行不同的过渡。

## 已做
- A 首轮反馈“像硬切”：A fade 改为 1.35 秒，B 从 0.65 秒进入，可听重叠由 0.037 秒增至 0.54 秒。
- B 首轮反馈“能量突然进来”：初始高通降至 900Hz、bass 提至 0.25，最终频谱恢复延长到完整 handoff。
- C 首轮反馈“A 结束后 B 才进”：B 从 A 尾句下方提前铺底，A 等人声结束再淡出；窗口由 3.4 秒增至 5.8 秒。
- 保留可信 Hook/Drop 预滚与落点约束；真实样本 Bubble Gum -> Riot Call、Killing Me -> Fortress、USA Today -> Believe In Me 分别命中 A/B/C。
- API、播放器评分上下文、本地/远端反馈记录均透传 `terminalRescueClass` 和原因。
- v2 三段试听输出在 `/tmp/cuefield-previews/`；切换发生在第 5 秒。
- 完整测试、syntax、diff check、HTTP/API 真实计划验证通过。

## 未做 / 下一步
- 用户复听 A/B/C v2 并评分；按新记录决定是否保留参数。

## 关键约束 / 红线
- A 优先级高于 B；C 不能因“曾等待过歌词”误判为 A。
- 保留 `desktop/main.js` 的用户本地 Metal edit；不得提交。

## 关键路径 / 文件
- `cuefield/transition-window-planner.js`, `cuefield/mineradio-bridge.js`, `cuefield/feedback-log.js`, `public/index.html`
