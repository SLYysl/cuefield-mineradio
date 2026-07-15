# Cuefield GitHub Showcase Design

> 日期：2026-07-15
> 目标仓库：`SLYysl/cuefield-mineradio`
> 目标读者：QQ 音乐、网易云音乐及相近音乐产品的工程师与技术负责人

## 目标

让访客在进入仓库后的 30 秒内确认四件事：

1. Cuefield 是运行在真实播放器里的 AutoMix 引擎，不是普通 crossfade。
2. 引擎会分析音乐结构、选择可解释的 transition recipe，并执行双 Deck 交接。
3. 仓库拥有 11 种真实配方、完整测试体系、离线预览工具和明确的数据边界。
4. Mineradio 是 Cuefield 的真实宿主，Cuefield 是本仓库的主角。

## 范围边界

本轮只修改 GitHub 展示层：

- 重写 `README.md`。
- 新增 README hero 和必要的展示图。
- 新增本设计说明。

本轮不修改：

- `cuefield/`、`public/`、`desktop/`、`server.js` 或其他运行代码。
- 测试、依赖、构建配置、播放器行为或音频参数。
- GitHub Release、安装包、生产部署或对外音频资产。

## 视觉系统

### 主视觉

用户提供的 `FE6CFB14-8D77-4738-A903-8D24122AD547.PNG` 作为 Cuefield 的主视觉源图。图中金属莫比乌斯立方体表达连续播放、A/B Deck 互换和闭环反馈。

生成一个 1600×760 的横向 hero：

- 右侧保留完整金属立方体，不改变其几何结构和材质表达。
- 背景扩展为深炭黑与暖银色，承接原图高光。
- 左侧使用英文标题 `Cuefield`。
- 副标题使用 `An explainable AutoMix engine for real music players.`。
- 底部展示经仓库重新验证的 recipe、test 和 commit 数字。
- Hero 使用 PNG，避免 GitHub 对 SVG 动画的限制和 Firefox SVG 显示差异。
- 源图与最终 hero 都放在 `docs/assets/readme/`。

### 视觉语气

- 金属、精密、克制，接近音频硬件与研究工具。
- 使用炭黑、暖银、低饱和铜色和少量冷蓝信号色。
- 不使用霓虹彩虹、廉价玻璃渐变、夸张营销图标或动画 GIF。

## README 信息结构

### 1. Hero

主视觉后紧跟英文定位和中文速览。首屏直接呈现项目角色、工程数字和主要入口。

### 2. Why Cuefield

用三条短句说明 Cuefield 相比固定时长 crossfade 的差异：

- 从 beat grid、downbeat、energy window、key 和 melody contour 读取结构证据。
- 根据歌曲关系选择 recipe 和 transition window。
- 在真实双 Deck runtime 中执行，并保留可回溯的诊断与反馈。

### 3. How It Works

展示一条静态架构链：

`Host data → Musical analysis → Structure map → Transition router → Recipe planner → Timeline executor → Feedback`

每个阶段链接到现有实现文件，不新增架构承诺。

### 4. Transition Recipe Matrix

README 展示当前 `recipe-planner.js` 中的 11 种配方：

- `safety-long-blend`
- `intro-outro-long-blend`
- `filtered-pickup`
- `bass-eq-handoff`
- `spectral-emergence`
- `quick-safe-fade`
- `echo-out`
- `source-loop-roll`
- `hook-teaser`
- `harmonic-double-drop`
- `tease-roll-double-drop`

表格为每种配方提供一句真实作用说明和主要安全条件。描述只来自当前实现与测试，不写无法验证的听感承诺。

### 5. Engineering Evidence

展示实现前重新统计的事实：

- 完整测试运行结果。
- Cuefield 核心与 runtime 的受控代码行数。
- 测试代码行数。
- 当前公开分支提交数。
- 数据边界测试与降级路径。

`94.7%` 现场反馈只保留为历史 listening checkpoint，并明确样本口径；它不作为整个引擎的通用准确率。

### 6. Architecture and Repository Map

明确目录角色：

- `cuefield/`：分析、结构、路由、配方、评估与离线渲染。
- `public/cuefield-*.js`：播放器内双 Deck 执行与 AutoMix 生命周期。
- `test/`：策略、运行时、失败关闭和数据边界测试。
- `docs/`：设计依据、听测记录和项目边界。
- Mineradio：真实 Electron host、队列、播放和 UI runtime。

### 7. Offline Preview CLI

提供当前 `cuefield/render-preview-cli.js` 的真实命令入口和输出说明。README 不放虚构的在线 Demo，也不提交受版权保护的音乐文件。

### 8. Safety and Data Boundary

保留并前置以下边界：音乐文件、Cookie、播放 URL、原始 beatmap cache 和私有反馈日志不会进入仓库。

### 9. Mineradio Host

将现有 Mineradio 下载、安装排障、支持渠道和长功能列表从 Cuefield 主叙事中移出。README 末尾只保留宿主关系、上游项目链接、许可证和第三方平台声明。

## 语言策略

- 英文承担主叙事、技术标题和配方说明。
- Hero 下提供简短中文速览。
- 不把每一段全文双语复制，避免 README 过长。

## 文件计划

- 修改：`README.md`
- 新增：`docs/assets/readme/cuefield-mobius-source.png`
- 新增：`docs/assets/readme/cuefield-mobius-hero.png`
- 新增：`docs/assets/readme/cuefield-architecture.svg`
- 新增：`docs/superpowers/specs/2026-07-15-cuefield-github-showcase-design.md`

## 验证标准

1. `git diff --name-only` 只出现 README、README 素材和本设计说明。
2. `git diff --check` 无空白错误。
3. `node --test test/*.test.js` 与修改前基线一致。
4. README 中的 recipe 名称与当前实现逐项匹配。
5. 统计数字由当前公开分支重新生成，不沿用旧派活数字。
6. Hero 在 GitHub 桌面与窄屏 README 中保持可读。
7. 公开 GitHub 页面实看后，首屏不再被 Mineradio 下载说明抢占。

## 发布边界

实现完成后先提交展示分支并展示本地 diff。推送到公开仓库不会部署应用，但会创建或更新公开 Git 分支；合并到 `main` 前再次向用户确认最终页面。
