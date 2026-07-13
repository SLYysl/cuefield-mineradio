# CURRENT_STATE - Cuefield track identity lock
> 更新时间: 2026-07-13 | 线程: B audio / C cover mismatch

## 目标
- 保证 Cuefield 预载音频、队列歌曲元数据和封面始终属于同一首歌。

## 已做
- AutoMix 触发前用 `pending.toKey` 校验当前 next slot；失配时丢弃旧预载并重新规划。
- 预载媒体写入 `_cuefieldSongKey`，`playQueueAt` 在修改播放状态前拒绝身份不匹配的媒体。
- 过渡开始后若 B 在队列中移动，最终交接按歌曲 key 找回 B；B 已移除则停止交接并重新准备。
- 新增 A -> B 预载后 next slot 变 C、过渡中 B 被移动、B 音频/C 元数据拒绝等回归。
- `node --test test/*.test.js` = 381/381；syntax、`git diff --check`、HTTP 200 通过。

## 未做 / 下一步
- 用户继续正常试听，观察是否还会出现声音与封面不一致。

## 关键约束 / 红线
- 未修改选歌、切歌时间、recipe 或音频过渡参数。
- 保留 `desktop/main.js` 的用户本地 Metal edit；不得提交。
- 本地 beatmap cache 与 `data/cuefield-feedback.jsonl` 不提交。

## 关键路径 / 文件
- `public/cuefield-automix.js`, `public/index.html`
- `test/cuefield-automix.test.js`, `test/cuefield-musical-integration.test.js`
- `test/cuefield-playback-handoff.test.js`
