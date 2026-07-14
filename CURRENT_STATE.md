# CURRENT_STATE - Cuefield staged spectral emergence
> 更新时间: 2026-07-14 | 线程: Camelot / DJ frequency-layer reveal

## 目标
- 让合适的 A release -> B climax 过渡通过分层频谱浮现，减少鼓点突然变薄或突然回来的听感。

## 已做
- 新增 `spectral-emergence`：B 先露中低频律动，再分三段恢复中高频，A 同步 bass duck 和 equal-power fade。
- 仅在可信 release、可信 beat grid、局部音乐兼容、A 低频已释放且 B 低频足够时启用；不会覆盖更强的 impact recipe。
- BPM 支持半拍/双拍节拍族；只有带 `rate` timeline 的新路线可使用需要微调的跨节拍族匹配。
- playback rate 限制在 0.94-1.06，保持音高，并在交接后 2.4 秒回到 1。
- B deck WebAudio 增加 low/mid/high 三频段，echo 从完整 EQ 链后取样。
- 速率参与 B 落点和被裁剪预滚的 seek 补偿。
- `node --test test/*.test.js` = 387/387；syntax、`git diff --check`、HTTP 200 通过。

## 未做 / 下一步
- 用户实际试听新路线，重点反馈鼓的身体感、B 人声出现时机和回速是否可察觉。
- 后续再加入局部音色/人声采样相似度；当前共同点仍以调性、旋律和结构证据为主。

## 关键约束 / 红线
- `spectral-emergence` 不是全局默认；bass collision 或人声重叠风险存在时必须回退。
- 保留 `desktop/main.js` 的用户本地 Metal edit；不得提交。

## 关键路径 / 文件
- `cuefield/recipe-planner.js`, `public/cuefield-timeline-executor.js`, `public/index.html`
- `test/cuefield-recipe-planner.test.js`, `test/cuefield-timeline-executor.test.js`, `test/cuefield-playback-handoff.test.js`
