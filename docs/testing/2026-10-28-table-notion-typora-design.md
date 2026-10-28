# 文档表格：Notion 操作与 Typora 简洁感

本地候选基于64ee45b与本次会话累计修改，版本保持0.1.249，未提交或发布。

## 设计依据

参考官方 [Notion 普通表格](https://www.notion.com/help/columns-headings-and-dividers)中的行列手柄、底部/右侧添加、拖动排序/列宽和适应页宽，以及 [Typora 表格编辑](https://support.typora.io/Table-Editing/)中的上下文工具、Markdown内容和键盘续行。视觉继续沿用Loop的现有字体、文档表面和主题。

本轮按文档普通表格实现。数据库属性、筛选、计算、合并单元格、行列色彩等未纳入本候选，不宣称与Notion全功能等价。

## 实际行为

- 静止时只显示文档内容和细网格；悬停或键盘聚焦时，才显示行列手柄、边缘“＋”和左上角菜单。
- 底部/右侧“＋”追加行列。行列手柄打开各自的就近菜单，支持相邻插入、复制、清空、移动、删除；表头行与最后一列保留保护。
- 拖动行列手柄重排，整行/整列数据一起移动；Escape、失焦或指针取消会取消拖动。菜单提供同等的键盘操作入口。
- 拖动列边界调整列宽。适应页宽、自动列宽和复制Markdown位于表格菜单；原精确设置作为补充入口保留。
- 列宽、列移动和结构操作纳入原编辑器Undo/Redo。继续复用既有tableColumnWidths、Markdown正文、自动保存、文件冲突和Recovery，不新建表格数据系统。
- Tab末格续行、Cmd/Ctrl+Enter下方插行、Shift+Enter单元格内换行；TSV粘贴、长中文换行和透明原位编辑保留。
- 换行仅允许表格中的`<br>`约定；普通正文、反斜线转义和行内代码保持字面文本，不启用任意HTML。

## 真实运行验证

本机macOS以当前生产源码运行Electron，数据全部来自独立合成profile。应用就绪后核对源码、profile、PID与版本；逐字节和SHA-256核验的初始备份位于证据目录baseline。

CUA原生鼠标/键盘实操：打开行列菜单、复制一行/撤销、拖动行重排/撤销、拖动列重排/撤销、拖动列边界、列对齐、自动列宽、Shift+Enter中文换行、主题切换、完整退出重启及保存。每组操作读取原生辅助功能状态并检查屏幕。

真实Electron专项补充覆盖：行列复制/清空/移动/删除、拖动取消、列宽精确撤销、菜单Esc焦点返回、适应页宽、快捷插行、换行安全、独立笔记保存/文件授权/进程重启，以及1024/1280×明暗主题菜单边界和页面溢出。该尺寸矩阵由真实BrowserWindow设置，不冒充物理跨屏/DPI验证。

实际验证暴露并修复：初轮历史隔离标注放错事务字段；行手柄与CodeMirror折叠槽重叠；列宽撤销/DOM重绘临时blur导致嵌套提交。未删除保护断言，分别修正实现、控件布局和blur提交时序。最终专项无pageerror。

## 检查结果

- `npm run check`：355主测试 + 12服务测试全部通过，构建通过。
- `tests/knowledge-editor.ui.cjs`：完整编辑器与新表格设计回归通过。
- `tests/knowledge-tables-and-links.ui.cjs`：真实Electron设计专项、明暗尺寸矩阵和重启通过，无pageerror。
- `git diff --check`与新模块/测试语法检查通过。
- 设计机械检测仅提示旧引用/Callout的3处线条，本次未改，保留项目原设计。

## 本地验收

应用保持打开，任务“文档表格设计”，笔记“方案对比”。鼠标移入表格可看到行列手柄和边缘“＋”。原正式数据没有读写，版本未改变。

- profile：`/Volumes/T7/work/personal-task-track/.local-review/knowledge-table-design-20261028/profile`
- 启动：`LOOP_USER_DATA_DIR=<上述绝对路径> npm run dev`；采用前轮唯一标识的Electron运行时副本，避免选错同机历史候选。
- 证据目录：`.local-review/knowledge-table-design-20261028/`
- 原生截图：`native-quiet.png`、`native-column-menu.png`、`native-dark-menu.png`；完整运行身份和最终静止状态见`final-runtime.json`。
- 自动实际Electron尺寸截图：`automated-native/table-design-{light,dark}-{1024,1280}.png`。

Windows原生手感、物理中文输入法与物理跨屏尚未验证；注入IME测试与本机系统剪贴板输入分别记录，不混称人工输入法验收。
