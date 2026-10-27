# 执行阶段3：任务工作台与真实处理流

先读`COMMON.md`、共享状态/决策、`handoffs/STAGE-02.md`和路线图阶段3，运行`node tools/frontend-remediation.cjs check 3`。沿用当前文件，不把前阶段样式回退为旧基线。

## 早期交接的具体承接

读取`BASELINE-STAGE-00.md`及阶段0交接中的性能待补项。阶段0只取得8任务/6节点的同步render样本，不能当作大树或端到端输入性能已通过。参考`.local-review/frontend-remediation/stage-00/fixtures/performance-medium.json`的300任务/3000节点种子，在本阶段独立profile中补充DOM规模、折叠/展开、输入到绘制、滚动、长按拖动与内存；比较同机同数据结果，并区分旧基线记录与当前候选新测值。

## 目标

完成任务标题、属性、简报、历史、真实树和节点记录的连贯工作界面，保留所有父子与编辑语义。

## 必须完成

1. 整理标题/属性/背景/进展/结论/页签/历史和保存回执。原位编辑透明，自动保存与一次会话历史保持。
2. 保留真实树关系，处理缩进、树线、长标题、状态、定位和操作显隐，不能用假树替换。
3. 完整验证根/子/同级创建、改名、折叠/展开、隐藏完成但保留未完成后代、下一待处理、右键、删除与撤销。
4. 整理记录侧面板、窄窗抽屉和阅读状态，保护焦点返回、滚动、IME、草稿及操作连续性/指针偏好。
5. 将折叠动效纳入已有生命周期；检查候选保留关闭子树DOM的大树成本。保持原长按拖动、非法目标和键盘能力，降低动效时不残留不可见焦点。
6. 对必要共享改动说明影响并回归阶段1–2。不要引入独立node-results原型的新字段、结论列或逐层模式。

## 代码重点

`workspace.js`、`brief21.*`、`flow.css`、`actions.js`、`app.js`树/记录部分、`continuity28.js`及既有指针适配契约。

## 验收与交接

- 数据检查必须覆盖parentId/order、跨层移动、深层树、已完成父节点的未完成后代；比较真实大树输入/折叠/拖动与基线性能。
- 参考`node-interactions.ui.cjs`、`node-context-menu.ui.cjs`、`flow-completed-filter.ui.cjs`、`continuity28.ui.cjs`、`pointer-continuity.test.cjs`；完整检查与空白检查。
- 明暗、窄窗、键盘、正常与减少动态效果的真实Electron预览；未实测原生平台明确列出。
- 写`handoffs/STAGE-03.md`、状态与新决策，停在本阶段，不提交或发布。
