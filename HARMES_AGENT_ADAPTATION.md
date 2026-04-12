# Harmes Agent 适配说明（OpenRoom / claw 分支）

适用路径：`/home/yarizakurahime/claw/OpenRoom`  
目的：解释“人物是否同一人、功能如何触发、后续开发该改哪里”。

## 1. 人物（Character）和 Agent 不是同一个概念

- Character（立绘/人设）来自 `characterManager.ts`，默认是 `Aoi`。
- Agent（对话执行者）来自 ChatPanel 的多 Agent 逻辑：
  - `aoi`
  - `lacia`
  - `methode`
  - `satonus`
  - `snowdrop`
  - `kouka`
- 结论：你看到的“6 个”主要是 **对话 Agent**，不是 6 个不同立绘人物。

## 2. 当前分支里“人物资源”现状

- 默认 Character 是 1 个（Aoi），但有多种媒体位：
  - `base_image_url`
  - `avatar_img_url`
  - `chat_pic_url`
  - `head_img_url`
  - `back_img_url`
  - `side_img_url`
  - `front_img_url`
- 情绪定义默认 6 个：`default/happy/shy/peaceful/depressing/angry`。
- 情绪媒体优先级：
  - `emotion_videos` > `emotion_images` > `base_image_url`
- 所以“看起来不止一个立绘”是正常的：同一个 Character 会按情绪切不同图/视频。

## 3. 触发机制总览

### 3.1 Agent 切换触发

- 触发方式 1：点击 ChatPanel 顶部 Agent tab。
- 触发方式 2：输入 `@agent` 前缀（例如 `@lacia ...`、`@m ...`）。
- 会话隔离维度：`character × mod × agent`，每个 Agent 有独立聊天历史。

### 3.2 Aoi 与其他 Agent 的分流

- 当目标 Agent 是 `aoi`：
  - 走本地 `runConversation()` 主循环；
  - 会执行工具链（文件读写、app_action、memory、image 等）。
- 当目标 Agent 不是 `aoi`：
  - 直接 POST 到 `http://localhost:18790/api/chat`；
  - 返回文本后直接显示，不走 Aoi 的工具主循环。

### 3.3 App 事件反向触发聊天

- 用户在 App 内操作会通过 `onUserAction` 上报。
- 仅当 **activeAgent === aoi** 且上报开关开启时，才会把这些事件转成消息继续推进对话。
- 上报可由底部 `report-toggle` 开关控制；上传/生成阶段会自动暂时关闭上报。

### 3.4 情绪与立绘切换触发

- 当模型调用 `respond_to_user`，并带 `character_expression.emotion` 时：
  - UI 会设置 `currentEmotion`；
  - 再按媒体优先级解析对应视频/图片并显示。

### 3.5 Mod 进度触发

- 模型调用 `finish_target` 可推进剧情目标；
- 目标完成后会持久化到 mod state，影响 stage 指示器和后续系统提示。

## 4. “彩蛋/独特功能”在本分支的实际清单

> 这里按 Harmes 适配后的当前代码计算，不是上游完整版。

- 桌面 App：4 个（`musicPlayer/diary/email/cyberNews`）+ OS。
- App 动作（meta.yaml）：
  - Music 18
  - Diary 5
  - Email 3
  - CyberNews 16
  - 合计 App 动作 42；加上 OS 动作 3（`OPEN_APP/CLOSE_APP/SET_WALLPAPER`）= 45。
- 对话工具能力：
  - `respond_to_user`
  - `finish_target`
  - `list_apps`
  - `app_action`
  - `file_read/file_write/file_list/file_delete`
  - `save_memory`
  - `generate_image`（配置 API Key 后启用）
- 上传角色卡（PNG/ZIP）自动解析并生成新 Mod（通过上传按钮 `upload-toggle`）。
- Live Wallpaper 开关（`wallpaper-toggle`）。
- 一键清空聊天 / 重置会话（包括 session 数据）入口。

## 5. 关于“透明视频 MP4 能不能做”

- 常见 `H.264 + yuv420p` 的 MP4 不带 alpha，不能真透明。
- 若要“动态透明立绘”，建议：
  - 使用 `WebM (VP9 alpha)`；
  - 或改为透明 PNG 序列/静态情绪图方案。

## 6. 后续开发建议（最实用）

- 改“谁负责回答/怎么分流”：
  - `apps/webuiapps/src/components/ChatPanel/index.tsx`
- 改“立绘与情绪媒体解析逻辑”：
  - `apps/webuiapps/src/lib/characterManager.ts`
  - `apps/webuiapps/src/components/ChatPanel/CharacterPanel.tsx`
- 改“可用 App 和动作注册”：
  - `apps/webuiapps/src/lib/appRegistry.ts`
  - `apps/webuiapps/src/pages/*/meta/*/meta.yaml`
- 改“壳层触发（上报、上传、壁纸等）”：
  - `apps/webuiapps/src/components/Shell/index.tsx`

## 7. 一句话结论

当前 Harmes 适配里，**多的是 Agent，不是多人物**；触发核心是“Agent 路由 + Aoi 工具主循环 + App 事件回流 + 情绪媒体优先级”。

---

## 8. OpenRoom-v1（`archive/OpenRoom-v1`）默认触发逻辑（用于二次开发复刻）

> 这是你要复刻的重点，不是 Harmes 精简版。  
> 代码来源：`/home/yarizakurahime/workspace/archive/OpenRoom-v1`

### 8.1 默认路由与执行模式（v1）

- v1 有 OpenClaw Router 概念，默认行为是：
  - Router 默认 `on`（本地无存储值时默认开启）
  - Active main agent 默认 `lacia`
  - Execution mode 默认 `hybrid`
- 如果本地 LLM 未配置，发送消息时会自动切到：
  - Router `on`
  - mode `direct`
  - 并直接把任务发给当前 active main agent。

### 8.2 v1 的主触发入口

- UI 入口触发：
  - 顶部 Router Agent lane（`lacia/methode/kouka/snowdrop/satonus`）
  - 设置面板里可改 Router 开关、Active Agent、direct/hybrid 模式。
- 命令触发（聊天框）：
  - `/oc use <agent>`
  - `/oc off`
  - `/oc mode direct|hybrid`
  - `/oc status`
  - `/oc <agent> <task>`（直接发某个 agent）
- 自动事件触发：
  - App 用户行为会被上报成 `[User performed action in ...]` 并进入对话队列；
  - OpenClaw mailbox 会在 router 打开时定时轮询（推送消息回显到聊天）。

### 8.3 “动作”在 v1 里有 3 层含义

- 层 1：角色语气动作（文本层）
  - 系统提示要求用括号动作表达，如 `(smiles)`；
  - UI 会把括号内容高亮显示（只是表现层，不是功能指令）。
- 层 2：模型工具动作（本地工具层）
  - `respond_to_user / finish_target / list_apps / app_action / file_* / save_memory / generate_image` 等。
- 层 3：OpenClaw 动作协议（跨后端层）
  - v1 支持在 OpenClaw 返回中携带 `openroom_actions` JSON；
  - 前端会解析并执行 `open_app / app_action / file_read / file_list / file_write / file_delete`。

### 8.4 “服装”是怎么引出的（v1）

- 结论：v1 没有独立“衣柜系统”或“换装状态机”。
- 服装来源有两种：
  - 人设文本中的 `appearance/current_state`（例如 yellow jacket）；
  - 立绘媒体本身（`base_image_url` 或 emotion 对应图/视频）。
- 也就是说，“服装变化”通常不是单独字段触发，而是：
  - 模型在文本里描述状态变化，或
  - 你手动在 Character 编辑器里切换基础图/情绪图视频 URL。

### 8.5 “情绪立绘”触发链（v1）

- `respond_to_user.character_expression.emotion` 被返回后：
  - ChatPanel 设置当前 emotion；
  - 角色媒体按优先级解析：`emotion_videos > emotion_images > base_image_url`；
  - Emotion 结束后回落到 idle/default。

### 8.6 Agent Ownership（你看到的徽章/归属）

- v1 有 `agentOwnership.ts`：
  - 每个 appId 映射一个“主负责 Agent”。
- 这个 ownership 本质是“默认偏好路由 + UI 标识”，不是权限限制。
- AppWindow 标题栏有 AgentBadge，显示 owner 的颜色/首字母/倾向。

### 8.7 v1 的默认应用与能力规模（复刻量级）

- 桌面 App：11 个（含 Blog；不含 OS）。
- App meta 动作数：72；加 OS 3 个系统动作，总计 75。
- 默认 Mod：4 stages / 10 targets。

### 8.8 v1 上传触发差异（和精简版不同）

- v1 上传是双路径：
  - PNG/ZIP：按角色卡导入 + 生成 Mod；
  - 其他任意文件：作为聊天上下文附件（不是角色卡）。

### 8.9 复刻建议（按优先级）

- P0（先复刻）：  
  - Router 状态机（on/off、active agent、direct/hybrid）  
  - `/oc` 命令分支  
  - `openroom_actions` 解析与执行
- P1（再复刻）：  
  - agent ownership badge（展示层）  
  - mailbox 轮询回流  
  - 文件上传双路径（卡导入 vs chat 附件）
- P2（最后微调）：  
  - 情绪视频切换动画  
  - Actions taken 展示开关  
  - 设置面板持久化项

---

## 9. OpenRoom + Hermes 融合方案（保留 Aoi 原能力）

目标：
- 保留 OpenRoom 原生 Aoi/Soul（人格、剧情、工具循环）
- 增加 Hermes Agent 的“外部能力调用”
- 两者都通过 API 输入，但对用户保持单一人格出口（Aoi）

### 9.1 推荐融合原则

- Aoi 是主脑（唯一用户可见人格）
- Hermes 是能力代理（检索、规划、代码、跨模型协作）
- Hermes 返回结构化结果，Aoi 再决定如何说、是否执行动作

### 9.2 最小融合架构（可落地）

- 在 ChatPanel 工具链中增加一个工具：`delegate_to_hermes`
- 工具调用时发送：
  - `task`
  - `session_id`
  - `aoi_profile`（来自 character_desc / Soul）
  - `stage_context`（当前 mod stage/targets）
  - `app_capabilities`（当前 list_apps + meta 能力）
- Hermes 返回：
  - `result_text`
  - `suggested_replies`
  - `emotion_hint`
  - `openroom_actions[]`（可选）
  - `trace`（调试）

### 9.3 API 约定建议

- `POST /api/hermes/delegate`
- request schema（建议）：
  - `task: string`
  - `agent?: string`
  - `session_id: string`
  - `context: { aoi_profile, soul, stage, memories, app_map }`
- response schema（建议）：
  - `ok: boolean`
  - `result_text: string`
  - `suggested_replies?: string[]`
  - `emotion_hint?: string`
  - `openroom_actions?: Array<{ type: string; ... }>`
  - `error?: string`

### 9.4 为什么这样最稳

- 不破坏现有 `runConversation()` 工具循环
- 不破坏 Aoi 设定和剧情连续性
- Hermes 可独立替换底层模型，不影响 OpenRoom UI 交互层

### 9.5 实施顺序（建议）

- P0：仅接 Hermes 文字结果（不执行 action）
- P1：允许 Hermes 返回 `openroom_actions` 并走 allowlist 执行
- P2：支持 Hermes 多角色编排（strategy/execution/review）并映射到现有 agent tab

---

## 10. OpenRoom-v1 触发彩蛋复刻点子（点子版）

> 你要的是“能复刻的创意点”，先不写死实现。

### 10.1 可复刻触发器（优先）

- 命令型触发：
  - `/oc use ...`、`/oc mode ...`、`/oc status` 这一套做成 Hermes 兼容命令别名
- 行为型触发：
  - 用户在某 App 连续操作 N 次后，触发对应 agent 的“主动提示/剧情推进”
- 阶段型触发：
  - 完成某 stage target 后，自动注入一次“彩蛋消息 + 推荐动作”
- 时间型触发：
  - 通过轮询/心跳（类似 v1 mailbox）投递“异步事件”

### 10.2 “服装/动作”彩蛋怎么做（不做衣柜系统也能跑）

- 轻量方案：
  - 用 `emotion_images/emotion_videos` 做“状态皮肤”
  - 用 `current_state` 文本做剧情态注释（例如“已换装：任务装”）
- 触发方式：
  - 当 stage 进入特定编号时，切换某个 emotion 媒体组
  - 当用户触发关键行为（打开某 app / 完成目标）时，临时切 emotion

### 10.3 彩蛋池设计点子

- App owner 彩蛋：
  - 打开某 app 时，根据 owner agent 推一个短 badge hint（不打断主对话）
- 组合彩蛋：
  - `wallpaper + music + one-line narrative` 三联动（一次只触发一项，避免轰炸）
- 记忆回调彩蛋：
  - 从 memory 中抽一条历史偏好，生成“低频回忆台词”
- 上传文件彩蛋：
  - 非卡文件上传后，Aoi 给一个“解析摘要 + 下一步建议”

### 10.4 复刻边界建议

- 必做：
  - 触发条件可配置（JSON）
  - 每个彩蛋带 cooldown（避免频繁重复）
  - 执行动作全走 allowlist
- 慎做：
  - 不让 Hermes 直接绕开 Aoi 对用户输出
  - 不让彩蛋直接写危险路径（仅 `apps/*`）

### 10.5 一句话复刻策略

先复刻“触发框架”再复刻“内容素材”：
- 先把命令/行为/阶段/时间四类触发跑通
- 再逐步填入服装、动作、剧情、邮件、壁纸等彩蛋内容
