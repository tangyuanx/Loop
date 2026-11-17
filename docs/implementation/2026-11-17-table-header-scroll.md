# 多表格笔记的表头错位与刷新跳动

用户报告：Windows v0.2.54 编辑含多张表格的笔记时，表头跳到表格中间、页面发生跳动，随后表头可能恢复。先在 Mac 尝试复现和修复。

## 基线与复现

- 本地最初为 v0.2.54 / `05c3e91`；保留既有记录后快进到远端 v0.2.56 / `a070181`。两版的相关表头与表格刷新判断相同。
- 使用真实 Mac Electron、独立 profile 和 24 张合成表格。先滚动测量多个表格，再编辑后方表格并刷新。
- 原版刷新前后，文档高度从 23895px 降到 13882px，当前表格 top 从 -358.27px 变为 -10371.27px。多个屏外表格的实测高度被重置为约 68px。
- 明暗切换触发工作区重绘还暴露了旧滚动容器引用：编辑器实例被复用并移到新容器，表头仍参照已脱离文档的旧容器，其 scrollHeight/clientHeight 都是 0。
- 原始证据：`.local-review/table-header-jump-20261117/baseline.json`；修复后同场景为 `probe.json`，点击、输入、完成、刷新前后所有被观察坐标一致。

## 原因与修改

1. `TableWidget.eq` 曾把缺少 HTML 缓存的屏外 widget 判为刷新后不等价。等价 widget 在编辑时被替换到装饰集合，并不总会挂载 DOM；丢失渲染快照使后续保存/资源刷新错误地重建高度图。现在等价实例传递渲染快照，跨刷新比较实际渲染结果，保留未变化表格的已测高度；资源内容确实变化时仍会更新。
2. 表头测量改为 CodeMirror 的 `requestMeasure` 读写阶段，跟随视口和几何变化，避免独立 rAF 与编辑器布局竞争。
3. 滚动事件由 document 捕获，再按编辑器当前的滚动祖先过滤；每次测量也重新解析当前容器。实例销毁时由既有 AbortController 取消监听。

保留现有表头吸顶、表格操作、输入样式、Undo/Redo、真实文件保存及编辑/预览行为。

## 验证

- `npm run build:knowledge` 和相关 JS 语法检查通过。
- `node --test tests/knowledge-core.test.cjs tests/knowledge-reliability.test.cjs`：42/42。
- `node tests/knowledge-table-headers.ui.cjs`：24 张表格、18 项逐帧位置断言通过。覆盖全部表格先测量后虚拟化、普通输入、实际文件保存、撤销/重做、连续刷新、编辑/预览吸顶与恢复、明暗主题、1280×850 与 1024×768；并检查复用后的滚动容器仍连接在真实 DOM 上。证据 `.local-review/table-headers-wRuPIV`。
- `node tests/knowledge-scroll-stability.ui.cjs`：58 项观察通过，包含普通/富文本单元格、中文组合输入、无表格的长正文、代码块和模式切换。证据 `.local-review/scroll-stability-120-kI6CQ0`。
- `node tests/knowledge-table-report.ui.cjs`：大表格渲染、源码、表格操作、剪贴板、合并宽度/间距、滚轮和文件保存通过。
- `git diff --check` 通过。

新回归已加入现有 `test:ui:knowledge-scroll`，由双平台集成/发布工作流调用；同时加入实际安装包知识笔记门禁。本地未运行 Windows 或安装包。用户随后明确要求发布当前候选，已核对远端 main/最高标签 v0.2.56 及候选源码摘要，仅将根版本元数据更新至 v0.2.57 并准备更新说明；产品实现保持不变。按根目录 RELEASE.md 继续云端完整检查、双平台实际包、Windows 升级和发布文件摘要门禁，全通过后才公开。

本地候选已通过 `npm run dev` 打开，PID 61620，源码目录 `/Volumes/T7/work/Loop`，版本元数据保持 v0.2.56。使用独立合成数据目录 `.local-review/table-header-jump-20261117/candidate-8hfUWC/profile` 和同目录旁的 `多表格验收.md`；主进程实际 appPath/userData、可见窗口和源码摘要已核对，记录于 `.local-review/table-header-jump-20261117/current-candidate.json`。人工验收待用户反馈。
