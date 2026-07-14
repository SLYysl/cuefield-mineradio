# CURRENT_STATE - Cuefield transition execution safety
> 更新时间: 2026-07-14 | 线程: 铁血丹心 source-loop 回退修复

## 目标
- 让合适的 A release -> B climax 过渡通过分层频谱浮现，减少鼓点突然变薄或突然回来的听感。

## 已做
- 新增 `spectral-emergence`：B 先露中低频律动，再分三段恢复中高频，A 同步 bass duck 和 equal-power fade。
- 仅在可信 release、可信 beat grid、局部音乐兼容、A 低频已释放且 B 低频足够时启用；不会覆盖更强的 impact recipe。
- BPM 支持半拍/双拍节拍族；只有带 `rate` timeline 的新路线可使用需要微调的跨节拍族匹配。
- playback rate 限制在 0.94-1.06，保持音高，并在交接后 2.4 秒回到 1。
- B deck WebAudio 增加 low/mid/high 三频段，echo 从完整 EQ 链后取样。
- 速率参与 B 落点和被裁剪预滚的 seek 补偿。
- `directionality mismatch` 不再允许 `tease-roll-double-drop` 循环 A 的旋律/人声片段。
- 铁血丹心 -> Never Be Like You 真实歌词复现已改走 `intro-outro-long-blend`，timeline 无 A loop/seek。
- `node --test test/*.test.js` = 388/388；syntax、`git diff --check`、HTTP 200 通过。

## 未做 / 下一步
- 用户复听 铁血丹心 -> Never Be Like You，确认不再回退或中间卡住。
- 后续再加入局部音色/人声采样相似度；当前共同点仍以调性、旋律和结构证据为主。

## 关键约束 / 红线
- `spectral-emergence` 不是全局默认；bass collision 或人声重叠风险存在时必须回退。
- 保留 `desktop/main.js` 的用户本地 Metal edit；不得提交。

## 关键路径 / 文件
- `cuefield/recipe-planner.js`, `public/cuefield-timeline-executor.js`, `public/index.html`
- `test/cuefield-recipe-planner.test.js`, `test/cuefield-timeline-executor.test.js`, `test/cuefield-playback-handoff.test.js`
