# AgentHub 真实链路验收与返工机制改造方案

## 1. 背景结论

最近一次真实链路验证证明，AgentHub 的主流程已经可以跑通：

```text
用户提出需求
-> 主脑判断任务阶段
-> 产品经理 Agent 澄清需求
-> 用户确认开始执行
-> 工程师 Agent 写入代码
-> Reviewer Agent 审查
-> 主脑综合最终回复
```

但这次交付没有达到“可运行产物”的标准。工程师 Agent 写出了前端页面，但微信小程序声明了 `cloudfunctions/`，实际云函数目录是空的；前端调用了 `login` 和 `election` 云函数，后端实现缺失。

更关键的是，工程师 Codex 子进程出现了超时和非零退出码，但系统因为拿到了最后一段文字，仍然把 AgentRun 标记成 `success`。这会让主脑、前端和用户误以为工程师任务已经完成。

## 2. 通俗解释

现在的系统像一个项目经理团队：

```text
主脑负责派活
产品经理负责问需求
工程师负责写代码
Reviewer 负责审查
主脑负责汇报
```

问题不是“没人干活”，而是“交付验收制度不够严格”。

这次的实际情况更像：

```text
工程师说：我前端写好了，接下来补后端。
进程随后超时或异常。
系统看到工程师说过话，就记录为成功。
Reviewer 后面发现：后端其实没有写，应用跑不起来。
```

所以接下来要补的是：

```text
不能只听 Agent 说自己完成。
必须检查进程是否正常结束、文件是否真实存在、关键功能是否齐全、Reviewer 是否通过。
没过验收就不能叫完成，只能叫 partial / failed / waiting_for_rework。
```

## 3. 改造目标

本阶段目标是把 AgentHub 从“能执行任务”升级为“能判断任务是否真正交付”。

最终期望效果：

```text
1. 用户确认执行后，主脑派工程师。
2. 工程师生成代码。
3. 系统自动检查交付清单。
4. Reviewer 审查代码。
5. 只有基础验收和 Reviewer 都通过，才允许主脑说完成。
6. 如果没过，主脑明确说明缺什么，并进入返工或等待用户确认。
```

关键原则：

- 子 Agent 有输出，不等于任务成功。
- 子进程超时或非零退出，不应默认为 success。
- 文件变化，不等于产物可运行。
- Reviewer 的 `PARTIAL` / `FAIL` 必须影响最终状态。
- 主脑最终回复必须和真实状态一致，不能把半成品包装成交付完成。

## 4. 当前发现的问题

### 4.1 工程师 Agent 成功判定过宽

当前真实验证中，工程师 Agent 的运行表现是：

```text
provider: codex
elapsedMs: 602507
changedFileCount: 27
logs:
- Codex process timed out after returning a valid final message.
- Codex exited with code 1 after returning a valid final message.
recorded status: success
```

问题是：进程已经出现 timeout / exit code 1，但状态仍然是 `success`。

应改为：

```text
timeout + valid final message + changed files = partial
exit code 1 + valid final message + changed files = partial
timeout + no useful output = failed
normal exit + useful output + expected files passed = success
```

### 4.2 缺少任务交付清单

主脑派给工程师的任务写了“完整微信小程序代码，包含前端页面、云函数和后端逻辑”，但系统没有把它转成可检查的结构化交付清单。

应该把自然语言任务扩展成：

```text
artifactKind: wechat_miniprogram
requiredFiles:
- project.config.json
- miniprogram/app.js
- miniprogram/app.json
- miniprogram/pages/index/index.js
- miniprogram/pages/create/create.js
- miniprogram/pages/detail/detail.js
- miniprogram/pages/result/result.js
- miniprogram/pages/manage/manage.js
- cloudfunctions/login/index.js
- cloudfunctions/election/index.js
requiredCapabilities:
- wx.cloud.init
- login cloud function
- createElection action
- listMyElections action
- getElection action
- vote action
- setStatus action
- removeElection action
```

这样系统才能检查“有没有做完”，而不是只看 Agent 自述。

### 4.3 缺少基础产物验收器

当前系统记录了 changeSet，但没有进一步判断这些文件是否满足任务要求。

这次如果有基础验收器，应该直接发现：

```text
project.config.json 声明 cloudfunctionRoot = cloudfunctions/
cloudfunctions/login 目录为空
cloudfunctions/election 目录为空
前端调用 login / election 云函数
对应后端实现不存在
```

验收结果应为：

```text
status: partial
blockingIssues:
- missing cloudfunctions/login/index.js
- missing cloudfunctions/election/index.js
- frontend calls cloud functions that do not exist
```

### 4.4 Reviewer 结果还没有形成强门禁

Reviewer 已经给出 `PARTIAL`，并指出云函数完全缺失。但主流程只是把它放进总结，没有把它变成强状态。

应改为：

```text
Reviewer PASS -> 主脑可宣布完成
Reviewer PARTIAL -> 主脑必须说明未完成项，并询问是否继续返工
Reviewer FAIL -> 主脑必须停止完成宣告，进入失败/返工状态
```

### 4.5 工作区 Git 状态和最终回复不一致

本次工作区内实际生成的 `miniprogram/` 和 `project.config.json` 仍是未跟踪文件，只有初始化 commit。

因此主脑最终回复不能说“代码已提交至工作区仓库”。更准确的说法应该是：

```text
代码已写入工作区，但尚未提交。
当前 changeSet 已记录 27 个新增文件。
产物验收未通过，原因是云函数缺失。
```

### 4.6 workflow events 被流式碎片挤占

当前 `workflowEvents` 最多保留 1000 条。本次真实链路中，大量 `agent_stdout_delta` 逐字事件占用了 975 条左右，导致早期路由、派发、工程师运行等关键事件被挤出。

这对前端回放和问题排查不利。

应改为：

```text
关键事件长期保留：
- routing_finished
- task_stage_updated
- agent_task_dispatched
- handoff_created
- agent_started
- agent_finished
- change_set_created
- validation_finished
- review_finished
- synthesis_finished
- workflow_finished

流式碎片限流/压缩：
- agent_stdout_delta
- agent_stderr_delta
```

## 5. 核心设计

### 5.1 新增交付状态模型

建议把 AgentRun 的执行结果拆成两层：

```text
processStatus: 子进程有没有正常跑完
deliveryStatus: 产物有没有交付成功
```

示例：

```text
processStatus:
- completed
- timeout
- exited_nonzero
- adapter_error

deliveryStatus:
- success
- partial
- failed
- not_applicable
```

这样可以表达更真实的情况：

```text
Codex 有输出，但进程超时，且文件缺失
-> processStatus = timeout
-> deliveryStatus = partial
```

### 5.2 AgentRun 成功判定规则

第一版建议规则：

```text
success:
- 子进程正常退出
- 没有 timeout
- adapter 没有 error
- 如果任务要求写文件，则必须有 changeSet
- 如果存在 deliveryChecklist，则基础验收通过

partial:
- 子进程有有效输出或部分文件变化
- 但 timeout / exit code != 0 / 基础验收未过 / Reviewer PARTIAL

failed:
- 子进程无有效输出
- adapter error
- 关键命令失败且没有产物
- Reviewer FAIL 且没有可用交付
```

注意：这里不是为了惩罚 Agent，而是为了避免“半成品被误认为成功”。

### 5.3 交付清单 DeliveryChecklist

建议在 `TaskHandoff` 或 AgentRun 输入中增加结构化字段：

```text
deliveryChecklist:
  artifactKind: static_site | wechat_miniprogram | node_app | document | unknown
  requiredFiles: string[]
  requiredDirectories: string[]
  requiredCapabilities: string[]
  validationRules: string[]
  mustBeRunnable: boolean
```

来源可以分三步：

1. 主脑 planner 根据任务生成初版。
2. 后端根据 artifactKind 补一层默认规则。
3. 用户明确约束优先级最高。

示例：微信小程序任务默认补充：

```text
requiredFiles:
- project.config.json
- miniprogram/app.json
- miniprogram/app.js

validationRules:
- project.config.json must parse as JSON
- miniprogramRoot must exist
- declared cloudfunctionRoot must not be empty when frontend calls wx.cloud.callFunction
- every called cloud function name must have an implementation directory and index.js
```

### 5.4 基础产物验收器

新增 `delivery-validator`，先做轻量规则，不引入复杂构建。

第一版支持：

```text
common:
- required files exist
- required directories exist
- changed files are not only empty directories
- generated files are inside workspace

wechat_miniprogram:
- project.config.json exists and parses
- miniprogramRoot exists
- app.json exists and declares pages
- declared pages have js/json/wxml/wxss where required
- wx.cloud.callFunction names can be discovered
- declared/called cloud functions have index.js

static_site:
- index.html exists
- referenced local css/js files exist
- no empty primary artifact
```

验收输出：

```text
DeliveryValidationResult:
  status: pass | partial | fail
  blockingIssues: Issue[]
  warnings: Issue[]
  checkedFiles: string[]
  missingFiles: string[]
```

### 5.5 Reviewer 门禁

Reviewer 输出需要结构化解析或本地兜底识别：

```text
reviewVerdict:
- PASS
- PARTIAL
- FAIL
- UNKNOWN
```

门禁规则：

```text
deliveryValidator = pass + reviewer = PASS
-> finalDeliveryStatus = success

deliveryValidator = partial/fail 或 reviewer = PARTIAL
-> finalDeliveryStatus = partial

reviewer = FAIL
-> finalDeliveryStatus = failed 或 partial，取决于是否有可保留产物
```

主脑最终回复必须引用 `finalDeliveryStatus`。

### 5.6 返工机制

第一版不建议直接自动无限返工，避免失控。建议做“一次明确返工入口”：

```text
如果 finalDeliveryStatus = partial:
  主脑说明缺失项
  主脑给出建议
  用户确认“继续补齐”后，再派工程师返工
```

后续可以升级为：

```text
低风险明确缺失 -> 自动返工一次
多次失败 / 高风险 / 需求变化 -> 等用户确认
```

返工任务应该包含：

```text
原始任务
已完成文件
验收失败项
Reviewer 发现
禁止重复重写无关文件
只修阻断问题
```

### 5.7 事件和日志保留策略

新增事件分级：

```text
critical:
- routing_finished
- agent_task_dispatched
- handoff_created
- agent_started
- agent_finished
- validation_finished
- review_finished
- workflow_finished

stream:
- agent_stdout_delta
- agent_stderr_delta

debug:
- context details
- raw model notes
```

第一版策略：

```text
critical 事件不被 stream 事件挤掉
stream 事件按 runId 聚合或限流
数据库保留完整 diagnosticLogs
CLI/SSE 仍可实时看到 stream
事后回放优先看 critical timeline
```

前端最终可以展示：

```text
主脑判断：执行
派发工程师：实现微信小程序
工程师执行：partial，原因：超时且云函数缺失
派发 Reviewer：审查代码
Reviewer：PARTIAL
主脑总结：当前不可运行，建议返工
```

## 6. 分批实施计划

### 第一批：修正“成功/失败/部分完成”判定

目标：先防止系统把半成品记成成功。

改造点：

```text
1. 调整 Codex / Claude adapter 的结果映射。
2. timeout 或 exit code != 0 时，即使有 final message，也标记 partial。
3. AgentRun logs 中保留 timeout / exit code 作为结构化原因。
4. 主脑综合时读取 run.status，不允许把 partial 说成 completed。
5. 最终回复禁止使用“已提交”“已完成”等与真实状态不符的措辞。
```

验收标准：

```text
给一个会超时但有输出的 Codex run:
- run.status = partial
- final message 说明部分完成
- workflow event 能看到 partial 原因
```

建议优先级：最高。

### 第二批：增加交付清单和基础验收器

目标：让系统不只听 Agent 自述，而是检查文件。

改造点：

```text
1. 为 TaskHandoff 增加 deliveryChecklist。
2. planner 生成 checklist，后端补默认规则。
3. 新增 delivery-validator 模块。
4. 微信小程序先支持 cloudfunctionRoot / wx.cloud.callFunction 检查。
5. static site 支持 index.html 和本地资源检查。
6. validation result 写入 artifact 或 workflow event。
```

验收标准：

```text
对于本次类似产物:
- 能发现 cloudfunctions/login/index.js 缺失
- 能发现 cloudfunctions/election/index.js 缺失
- finalDeliveryStatus = partial
```

建议优先级：最高。

### 第三批：Reviewer 门禁和返工入口

目标：Reviewer 不是只写报告，而是能影响交付状态。

改造点：

```text
1. 从 Reviewer 输出中提取 PASS / PARTIAL / FAIL。
2. 将 reviewer verdict 写入 workflow event。
3. 主脑综合读取 reviewer verdict。
4. PARTIAL / FAIL 时生成返工建议。
5. 用户确认后可按失败项生成返工 handoff。
```

验收标准：

```text
Reviewer 输出 PARTIAL:
- workflow final status = partial
- 主脑明确列出阻断问题
- 主脑询问是否继续返工
```

建议优先级：高。

### 第四批：事件保留和前端可观测性

目标：前端和 CLI 都能看清楚“谁接了什么任务、做到什么程度、为什么没过”。

改造点：

```text
1. workflow events 拆分 critical / stream / debug。
2. stream delta 不再挤掉 critical events。
3. CLI /logs 默认展示 critical timeline。
4. /logs --stream 再展示详细 stdout/stderr。
5. SSE 保持实时输出，但数据库存储做聚合或限流。
```

验收标准：

```text
长时间子 Agent 执行后:
- 仍能查到本轮 routing / handoff / run / validation / review / final events
- stdout_delta 不会把关键事件挤出
```

建议优先级：中高。

### 第五批：Git 状态和产物归档一致性

目标：最终回复和实际工作区状态一致。

改造点：

```text
1. changeSet 继续记录文件变化。
2. final response 明确区分“已写入工作区”和“已提交”。
3. 如果未来需要自动 commit，应作为单独配置开关。
4. zip / preview / artifact 事件引用当前真实文件状态。
```

验收标准：

```text
文件未提交时:
- 主脑不能说“已提交”
- /runs 或最终回复能说明当前是 uncommitted changes
```

建议优先级：中。

## 7. 建议文件拆分

为了遵守“1000 行以上视为大文件”的约束，建议按职责新增小模块。

可能新增：

```text
src/server/orchestrator/delivery/
  checklist.ts
  validator.ts
  validators/
    common.ts
    static-site.ts
    wechat-miniprogram.ts
  verdict.ts

src/server/orchestrator/workflow/
  run-status.ts
  rework.ts
  event-retention.ts
```

设计原则：

- 每个模块职责单一。
- 不把 validator 逻辑继续堆进 `workflow.ts`。
- 不让单文件超过 1000 行。
- 先做规则检查，不引入重型构建系统。

## 8. 数据结构建议

### 8.1 TaskHandoff 增加字段

```text
deliveryChecklist?: {
  artifactKind: string
  requiredFiles: string[]
  requiredDirectories: string[]
  requiredCapabilities: string[]
  validationRules: string[]
  mustBeRunnable: boolean
}
```

### 8.2 AgentRun 增加字段

```text
processStatus?: 'completed' | 'timeout' | 'exited_nonzero' | 'adapter_error'
deliveryStatus?: 'success' | 'partial' | 'failed' | 'not_applicable'
deliveryIssues?: Issue[]
```

如果短期不想迁移数据库，也可以先把这些信息放进现有 `logs` / `artifacts` / `workflow_events`，等规则稳定后再正式入表。

### 8.3 新增 workflow event

```text
delivery_validation_started
delivery_validation_finished
review_verdict_extracted
rework_requested
```

## 9. 手动真实测试方案

### 9.1 正常需求对接

```text
npm run chat:new
npm run chat
@main 我想做一个关于投票的小程序
```

预期：

```text
进入 requirements_intake
不会直接派 engineer
可能派 product-manager
```

### 9.2 用户确认执行

```text
@main 可以，按你的计划开始实现
```

预期：

```text
进入 execution
派 engineer
工程师执行状态可见
```

### 9.3 缺失云函数验收

构造或复用一个只有前端、没有云函数的小程序工作区。

预期：

```text
deliveryValidator = partial
blockingIssues 包含 login/election 云函数缺失
最终回复不得说完成
```

### 9.4 Reviewer PARTIAL 门禁

让 Reviewer 输出 PARTIAL。

预期：

```text
workflow final status = partial
主脑说明未完成项
主脑建议继续返工
```

### 9.5 长输出事件保留

执行一个输出较长的子 Agent。

预期：

```text
stdout_delta 可以实时展示
但 routing / handoff / validation / final events 仍可查询
```

## 10. 风险和取舍

### 10.1 不要一开始做太重的构建系统

微信小程序真实运行需要微信开发者工具或云开发环境，本地不能完全验证所有逻辑。第一版只做“文件完整性 + 调用关系 + 基础 JSON 解析”即可。

### 10.2 不要完全依赖 Reviewer

Reviewer 仍然是模型，可能漏判。基础验收器负责确定性检查，Reviewer 负责质量、安全、设计问题。

### 10.3 不建议立即自动无限返工

自动返工容易反复改坏已有文件。第一版建议用户确认后返工；后续再允许“低风险自动返工一次”。

### 10.4 不建议把 stream delta 全量长期存主表

实时流式对体验重要，但长期回放更需要关键节点。应该把“直播流”和“审计时间线”分开管理。

## 11. 推荐实施顺序

建议按下面顺序实施：

```text
第一批：AgentRun 状态判定修正
第二批：DeliveryChecklist + delivery-validator
第三批：Reviewer verdict 门禁 + 返工入口
第四批：workflow events 保留策略
第五批：Git 状态与最终回复一致性
```

如果只做最小闭环，必须完成前三批。

最小可接受效果：

```text
工程师没做完 -> 系统识别 partial
云函数缺失 -> 系统自动指出
Reviewer PARTIAL -> 主脑不说完成
用户可选择继续返工
```

## 12. 当前完成度判断

按“比赛 demo 真实链路”角度：

```text
主脑路由：基本可用
需求对接：基本可用
子 Agent 派发：基本可用
执行过程可见：已具备，但事件保留需要优化
代码落盘：已具备
Reviewer 审查：已具备
最终综合：基本可用
交付验收：不足
返工闭环：不足
```

所以当前不是要推翻架构，而是补“交付验收”和“返工闭环”。

一句话总结：

```text
AgentHub 已经像一个能派活的团队；下一步要让它像一个有验收制度的团队。
```
