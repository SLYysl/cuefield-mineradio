# CURRENT_STATE - Cuefield Impact Combo
> 更新时间: 2026-07-13 | 线程: Task 6 real-song regression

## 目标
- 在严格结构/节拍/旋律门槛下执行 teaser + source roll + double drop，并保留自然降级。

## 已做
- `tease-roll-double-drop`: B Hook teaser、A 4/2/1/0.5 beat roll、140ms fake-out、B Hook/Drop impact。
- fake-out 超过 60ms 会跳过；运行时降级、成功 handoff 后 cooldown、compact feedback 已接通。
- Echo Out 保留 A 0.32 bed，B 进入后 A 再延迟淡出。
- camera beats 继续负责结构/能量；pulse beats 独立提供 grid quality，标准 0.72 confidence 且 timing stability >= 0.85 才可信。
- 窗口评分按 Impact 的短 teaser overlap 评估，并在总分并列时服从 recipe selection score。
- 真实规划：`铁血丹心 -> Never Be Like You` 选择 Impact；cooldown 后不再选择 Impact，当前降级 `intro-outro-long-blend`。
- `Lucifer -> Teenage Dreams` 仍选择 `late-contrast-release + echo-out`。
- 回归：`node --test test/*.test.js` = 376/376；syntax 与 `git diff --check` 通过。

## 未做 / 下一步
- 人工试听上述 Impact 配对，重点听 teaser、roll、fake-out 和 B impact 是否自然。
- 根据 typed feedback 再调动作参数；当前不放宽 Hook/旋律/速度/exit 安全门槛。

## 关键约束 / 红线
- 保留 `desktop/main.js` 的用户本地 Metal edit；不得提交。
- 本地 beatmap cache 与 `data/cuefield-feedback.jsonl` 不提交。

## 关键路径 / 文件
- `cuefield/adapter-mineradio.js`, `cuefield/cue-profile.js`, `cuefield/recipe-planner.js`
- `cuefield/transition-window-planner.js`, `public/cuefield-timeline-executor.js`, `test/*.test.js`
