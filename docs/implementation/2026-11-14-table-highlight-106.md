# 需求 #106：表格行列范围反馈

- 需求：[Notion #106](https://app.notion.com/p/418481a1e66281928c30d73e6e79369c)，版本 3。
- 用户已确认：点击后才加深，悬停不触发；移开鼠标仍保留，点击其他行列按钮切换，点击表格外恢复。
- 基线 e0d6a2f / v0.2.34；本轮为本地候选，等待用户验收，未授权发布。

## 实现

- `knowledge-table-controls.js` 为真实表格单元格设置临时界面标记；一个范围在多个表格/编辑器间互斥。表格外 pointerdown 和键盘触发的 click 均可解除。
- `knowledge-editor.css` 使用主题中的中性文字色与画布色混合加深背景，保留边线、链接和透明单元格编辑器。键盘焦点沿用中性细线。
- 关闭行列菜单本身保留范围；菜单命令在表格外激活时恢复。拖动开始和组件销毁时清理标记、外部事件监听，避免行列移动或重建后的旧范围。
- `TableWidget` 不再拦截子按钮的 Enter/Space，保留原有表格与单元格键盘入口。
- 不增加存储字段、IPC 或第二份表格模型；不触发文档事务、保存、dirty 或撤销历史。vendor 从源代码重新构建。

## 验证

- `npm run build:knowledge`、源文件及测试语法、`git diff --check` 通过。
- `node --test tests/knowledge-core.test.cjs`：21 项通过。
- `npm run test:ui:knowledge-table-highlight`：真实 Electron 全部通过，证据 `.local-review/table-highlight-gLLQV6/result.json`，明暗主题 1280/1024 截图同目录。
- 覆盖行/列/表头点击、悬停不触发、移开保留、菜单关闭、表格内外点击、Enter/Space、多个表格、明暗与标准/特大字号、横纵滚动、增删/重排/拖动/撤销、重载清理。纯提示前后 Markdown、笔记状态、原文件内容和修改时间保持一致，撤销无新增记录。
- `node tests/knowledge-tables-and-links.ui.cjs`：完整表格与关联、真实文件读写、进程重启、菜单/拖动/列宽/取消/键盘回归通过。旧脚本增加等待新文件编辑器真正挂载后再读正文，保留原断言。
- `node tests/memo-editor.ui.cjs`：表格/处理流编辑、IME、保存失败保留、Shift+Enter、剪贴板和链接回归通过。

## 用户验收

运行 `npm run test:ui:knowledge-table-highlight -- --review` 打开当前源码的真实 Electron 窗口，使用独立合成 profile 和样例 Markdown，不使用正式数据。启动身份、PID、profile、截图记录在新的 `.local-review/table-highlight-*/runtime.json`。

1. 点击第一张表某行的左侧按钮，检查整行加深；关闭菜单、移开鼠标，高亮仍保留。
2. 点击某列上方按钮，检查整列加深并清除上一行提示；只悬停其他按钮不切换。
3. 点击表格外正文或页脚，检查恢复；滚动到第二张表重复检查。
4. 按需要切换明暗主题，检查文字、边线与原操作均可辨认。

用户人工验收及正式发布结果尚未发生，不能以自动验证代替。
