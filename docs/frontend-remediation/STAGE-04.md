# 执行阶段4：知识工作区

先读`COMMON.md`、共享状态/决策、`handoffs/STAGE-03.md`和路线图阶段4，运行`node tools/frontend-remediation.cjs check 4`。这是数据敏感阶段，使用可验证的独立数据与Markdown副本。

## 早期交接的具体承接

- 读取`BASELINE-STAGE-00.md`及阶段0交接：原编辑模式/页宽记忆等行为仍待本阶段对照当前`knowledge-workspace.js`评估。参考stage-00的`classification.json`、`backup-original/files/`及`archived-old-extra/`追溯，只迁入有明确价值且验证兼容的具体行为，不整包恢复旧编辑器、旧app.js或旧测试。
- 保留阶段0延续的`app/main/knowledge-watcher.cjs`轮询补偿与`tests/knowledge-watcher-polling.test.cjs`；涉及外部文件监听或清理时回归该用例。
- 长笔记和异常元数据种子已经准备，但不代表真实外部文件冲突、只读/丢失、Recovery或长笔记性能已经实测；本阶段按下面检查点补齐真实链路证据。

## 目标

统一知识阅读/编辑/源码与真实文件状态；保持CodeMirror、Markdown、Recovery和保存链路。

## 按三个检查点推进

1. **工作区和排版**：页签、工具栏、模式、专注、切换、宽度、目录/反向链接与底部回执。保护区域/编辑器实例复用。
2. **复杂编辑**：文字/选区、代码、表格、图片、公式、列表/引用、内部/外部链接、查找/替换。检查第三方内部选择，保留IME、Undo/Redo、光标与滚动。
3. **文件状态**：准确区分保存到Loop、草稿保留、文件保存、未同步、只读/丢失/外部改动。保留Recovery、重读、覆盖、另存、附件暂存和退出握手，核对导出Markdown/HTML/PDF。

各检查点产生可审阅成果与记录，最终收口为同一阶段；不要分别提交或升版本。

## 不变量与边界

- 不更换编辑器或框架，不按Milkdown历史命名误删兼容/构建链路。
- 不重建编辑器以方便换皮，不修改正文、换行、附件或绑定；保存失败不误报成功，冲突不静默覆盖。
- 不默认新增完整diff、云同步或新文件格式。打印输出独立核对，不套用应用暗色。
- 调整高级格式后回归普通输入和既有任务工作区，保留透明原位编辑及中性焦点。

## 代码重点

`knowledge-workspace.js`、`workbench.*`、`knowledge.js`、`knowledge-editor.entry.js`/CSS、`knowledge-core.js`、`knowledge-search.js`、`knowledge-renderer.js`、`knowledge-document.js`、`knowledge-recovery.js`及知识主进程边界。修改生成物时运行现有构建器。

## 验收与交接

- 覆盖无/有外部绑定、长笔记、CRLF、图片/表格、三模式和任务往返、保存失败、冲突与恢复，保持正文和Undo保真。
- 参考`test:knowledge`以及knowledge-editor/desktop/image/search/conflict/feedback/release-regressions的UI专项；记录哪些真实Electron、哪些浏览器/注入测试，不能混称。
- 完整检查、空白检查和真实Electron明暗预览。打包知识链路未运行时登记到阶段8。
- 写`handoffs/STAGE-04.md`与状态/决策，保留文件副本和证据，不提交或发布。
