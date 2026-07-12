# CURRENT_STATE - Cuefield local musical windows
> 更新时间: 2026-07-12 | 线程: Task 6 final regression and checkpoint

## 目标
- 让局部音乐窗口参与 transition matching，同时服从结构与可执行性约束。

## 已做
- transition-aware sampling，最多 4 个 4s 窗口；分析上限 <=16s。
- compact local profiles、pair ranking 与 compact feedback diagnostics。
- 高置信 clash 会阻止 long overlap 和 harmonic double-drop，但保留短可执行 fallback。
- old/weak cache 对 local musical scoring 保持 neutral；local evidence 不覆盖 structure/vocal/timing。
- 回归：`node --test test/*.test.js` = 346/346 tests pass, 0 fail。
- sampler 聚焦测试 = 11 tests, 11 pass，并确认 <=22050*16 cap。
- smart candidate evaluation skips Basic Pitch。
- final selected A/B uses sanitized lyric+beat structure windows, then replans once。
- upstream queue: one active request, max 4 queued；standard-quality URL lookup 8s；stream 32MiB。
- fetch/decode/refinement each have bounded timeouts；structured result cannot be overwritten by stale generic。

## 未做 / 下一步
- real-song listening，确认局部匹配在真实歌曲上听感成立。

## 关键约束 / 红线
- <=16s analysis；local evidence cannot override structure/vocal/timing。
- 保留 `desktop/main.js` 的 local Metal edit；本 checkpoint 不包含它。

## 关键路径 / 文件
- `cuefield/musical-profile.js`, `cuefield/transition-window-planner.js`
- `public/cuefield-musical-sampler.js`, `desktop/cuefield-musical-worker.js`
- `server.js`, `test/cuefield-musical-sampler.test.js`, `test/*.test.js`
