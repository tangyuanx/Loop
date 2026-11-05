# 右侧任务工作区协调整理

2026-10-30，针对用户提供的右栏截图调整真实应用。本轮候选尚未提交或发布。

## 改动范围

- 简报、页签、树工具和底部状态采用24px外层基准；窄窗口的树滚动区沿用原16px边距，页签、工具栏与底栏仍为24px。
- 页签与树工具栏收为40px，节点行基准38px；字号仍随用户设置，长标题自然增高。
- “收起全部”归到树工具栏，有分支时显示；补齐当前任务ID并正确处理部分折叠的分支。
- 节点分享与新增图标同基线；待处理节点不重复显示状态文字，保留左侧状态操作和可访问名称。
- 简报折叠直接更新既有区域，避免编辑后折叠时重建输入、树及记录实例。
- 沿用用户已选细线圆环i、内容自适应极小详情与未设属性留白。

## 本地验证

- `node --test tests/desktop.test.cjs tests/frontend-foundation.test.cjs`：237项通过。
- `node tests/node-interactions.ui.cjs`：通过，新增真实工具栏全部折叠/展开及部分折叠场景；原有改名、拖动等检查保留。
- `node tests/flow-completed-filter.ui.cjs`、`node tests/node-context-menu.ui.cjs`：通过。
- `.local-review/right-workspace-20261030/review.cjs`：真实Electron、生产存储及隔离合成数据；实际编辑简报后折叠/展开，断言输入与树DOM身份、透明输入和磁盘内容；无页面错误。
- 明暗主题×1024×680/1440×900，以及最大字号长标题和空任务集中截图；无横向页面溢出，分享/新增图标中心一致。
- `node --check`两处JS、`git diff --check`通过；Impeccable机械检测结果`[]`。

完整本地证据位于`.local-review/right-workspace-20261030/`。截图为真实Electron渲染内容，不代表安装包或人工验收；本轮不涉及安装/更新机制，未重复双平台打包。

独立finish reviewer逐张审阅六张截图、原图和源码差异，结论为`ship`，本轮范围无待修实质问题；行为检查沿用主会话证据，未重复运行。该结论只用于本地候选交付。

## 用户候选

`LOOP_USER_DATA_DIR=<绝对隔离路径> npm run dev`启动，应用标题“Loop · 右侧工作区设计验收（隔离数据）”。运行时确认源码路径为当前工作区，版本0.2.6，PID14764，profile为`.local-review/right-workspace-20261030/candidate-uK7tyw/user-data`。

合成数据启动前经生产存储规范化并备份，SHA-256核验一致；运行信息及摘要在`current.json`。正式数据与此前候选窗口保持，等待用户实际体验。
