# 阶段01交接：全局基础与公共控件

## 状态与现场

- 状态：`blocked`。公共基础迁移和自动化检查已完成；Mac 解锁后重新启动 Electron 仍在 `RegisterApplication` / `NSApplication` 初始化阶段触发 `SIGABRT`，真实明暗/键盘/三窗口预览尚未完成，不能声称本阶段视觉验收通过。
- 固定工作区：`/Volumes/T7/work/personal-task-track`。
- 整改分支：`codex/frontend-remediation`；开始/当前 HEAD 均为 `482912b76c8666af849bbbdfd2ea806ba87bbaa4`，没有提交、升版、标签或推送。
- 会话标识：`frontend-stage-01-20261026-root`；开始时间记录在 `state.json`，日期为2026-10-26（Asia/Shanghai）。
- 阶段0累计改动全部保留：`app/main/knowledge-watcher.cjs`、`prototypes/README.md`、阶段0文档/工具/测试、历史原型与归档资料均未清理或重置。
- 阶段1预览 profile：`/Volumes/T7/work/personal-task-track/.local-review/frontend-remediation/stage-01/review-profile`。它由阶段0隔离 profile 复制而来，已将复制产生的 `Singleton*` 锁文件移入同目录 `profile-lock-backup*`，没有读写正式用户目录。预览辅助脚本为 `review-foundation.cjs`。
- 阶段0的候选窗口和本次失败启动留下的默认 Electron 窗口均已退出；当前没有留下可供用户审阅的阶段1 Electron 窗口。后续应从本交接的恢复步骤重新启动，不要把阶段0 profile 当作阶段1结果。

## 实际交付

- 新增 [foundation.css](../../../app/renderer/src/foundation.css)：统一持有主题派生令牌、浅/深色输入中性线、搜索微色阶、原位编辑透明规则、键盘焦点内置细线、选区、菜单/列表框焦点、错误/禁用/加载语义和 reduced-motion。
- `index.html`、`today-widget.html`、`widget-surface.html` 均加入 `data-foundation-enabled`，并把 `foundation.css` 放到该入口最后，确保主窗口、今日浮窗、辅助浮窗共享同一基础层。
- `bridge.css` 和 `knowledge-editor.css` 只保留必要产品例外：移除搜索父容器绿色焦点、处理流/简报/分隔器焦点绿环，统一知识查找、表格单元格、CodeMirror 光标与富文本链接焦点。
- `workbench.css` 的文本菜单键盘焦点改为中性内线；冻结 Demo 的 `shell.css`、`fonts.css`、`knowledge.css`、`brief21.css`、`controls22.css`、`widget12.css`、`widget13.css`、`management24.css`、`window25.css`、`recovery26.css` 等仍保持原字节内容，由 foundation body scope 和变量接管其运行时焦点值。
- `tests/frontend-foundation.test.cjs` 新增3项契约检查；`tests/desktop.test.cjs`只更新入口样式顺序断言，使最后的 `foundation.css`成为明确的共享层。
- `DECISIONS.md`追加 D17–D18，记录样式所有者、冻结文件边界和中性焦点变量解析方式。

### 样式所有者与控件用法

| 区域 | 所有者 | 本阶段规则 | 例外/后续 |
| --- | --- | --- | --- |
| 主题、字体派生、普通控件、焦点、选区、禁用/加载/反馈 | `foundation.css` | 中性细线/内置底线；无绿色 border、outline、外圈或光晕 | 语义绿色仍可用于完成、选中和今日入口；不表示输入焦点 |
| 搜索 | `foundation.css` + `bridge.css` | 内部透明，父背景保持微色阶，focus-within 只显示中性底线 | 主窗口、浮窗和知识查找的真实截图待解锁后补齐 |
| 原位标题/分组/简报/记录/富文本/表格单元格 | foundation 的透明编辑规则；知识编辑器保留第三方边界 | 所在项目底色不变，焦点为中性内置底线 | Milkdown/CodeMirror 的第三方工具按钮仍由编辑器语义管理，阶段4再做完整编辑器体验核对 |
| 菜单、分段控件、下拉/listbox | `foundation.css` 末层 + 原有 phase 脚本 | 键盘焦点使用中性内线，禁用保留语义，原生 select/FormData/IME/Tab/Enter/Esc 不改 | 业务页面几何与动作留后续阶段 |
| 今日/辅助窗口 | 同一 `foundation.css`，入口各自保留原 bridge | 输入硬规则先共享，窗口置顶/穿透/几何不在本阶段重做 | 完整行为和跨窗视觉归阶段7 |

## 前阶段事项的承接与去向

| 来源阶段/文件 | 事项与接手时实际状态 | 本阶段处理与证据 | 结果/后续目标阶段 |
| --- | --- | --- | --- |
| 阶段0 D14、`BASELINE-STAGE-00.md:86`、`handoffs/STAGE-00.md` | `.list-search:focus-within` 明暗主题都有绿色边线及底色跳变 | foundation/bridge 改为中性边线和内置底线；契约测试覆盖 selector，真实截图待解锁 | 代码已完成；解锁后补真实视觉证据 |
| 阶段0 D11、候选 `neutral-inputs.css` / `quiet-surface.css` | 候选只作参考，不能整包复制；冻结 Demo 文件必须保留 | 只提取中性输入、主题令牌、字号/字重和 reduced-motion 角色到 foundation；冻结层字节检查通过 | 已完成；阶段2–7沿用 foundation，不复制候选应用 |
| 阶段0 D10、`app/main/knowledge-watcher.cjs` 与轮询用例 | 外部卷轮询补偿和测试是累计改动 | 未触碰；阶段专项仍通过 | 已完成，后续保持 |
| 阶段0 `BASELINE-STAGE-00.md:39` | 旧编辑模式/页宽记忆留阶段4判断 | 本阶段未恢复旧编辑器、未改 schema/IPC | 仍待处理→阶段4 |
| 阶段0 `BASELINE-STAGE-00.md:117` | 300任务/3000节点与长笔记性能待后续验证 | 未扩大本阶段范围 | 仍待处理→阶段3/4 |

## 检查与证据

证据根目录：`/Volumes/T7/work/personal-task-track/.local-review/frontend-remediation/stage-01/`。

| 检查 | 实际命令/操作 | 结果 | 日志/截图路径 | 限制 |
| --- | --- | --- | --- | --- |
| 阶段前置 | `node tools/frontend-remediation.cjs status`、`check 1` | 通过；分支、HEAD、累计 dirty 和前置状态正确 | `stage-tests.log` 前置输出、终端记录 | 只读检查不是用户验收 |
| 阶段专项 | `node --test tests/frontend-remediation.test.cjs tests/knowledge-watcher-polling.test.cjs tests/frontend-foundation.test.cjs` | 9/9通过，无跳过 | `stage-tests.log` | 契约和 watcher 用例；不是原生视觉替代 |
| CSS 语法 | `postcss.parse` 检查 `foundation.css`、`bridge.css`、`knowledge-editor.css` | 通过 | `css-parse.log` | 未替代浏览器最终 computed style |
| 完整检查 | `npm run check` | 主测试347/347、服务测试12/12，无跳过 | `npm-check.log` | 未做发布构建；本阶段不发布 |
| 空白 | `git diff --check` | 通过 | `diff-check.log` | 仍保留前阶段 dirty 现场 |
| 冻结源保护 | `tests/frontend-foundation.test.cjs` 与 `tests/desktop.test.cjs` | 冻结 Demo CSS 字节一致，foundation 只作为末层共享规则 | `foundation-tests.log`、`npm-check.log` | 运行时覆盖待 Electron 验证 |
| 真实 Electron | 首次锁屏时尝试 `LOOP_USER_DATA_DIR=<stage-01 profile> npm run dev -- --remote-debugging-port=9590 --inspect=9591`；解锁后再次用同一 profile 运行无调试参数和调试参数启动 | 阻塞：Electron 42.7.0 仍在 macOS `RegisterApplication` / `NSApplication` 初始化阶段收到 `SIGABRT`；失败启动留下的默认窗口已关闭 | `review-foundation.cjs`、系统报告 `/Users/xuetangyuan/Library/Logs/DiagnosticReports/Electron-2026-10-26-235712.ips` | 没有生成明暗截图、computed style、键盘/IME/三窗口证据；需在 Electron/LaunchServices 恢复后重跑 |

## 用户审阅

- 用户本阶段指令：在固定工作区读取公共规则、状态与 `STAGE-01.md`，只执行阶段1，保留累计改动，完成检查、真实本地预览和交接，不提交或发布。
- 已完成：共享 foundation 迁移、冻结文件保护、专项/完整检查和恢复脚本准备。
- 尚未完成：用户可见的真实 Electron 明暗、普通输入/搜索/原位标题/正文/表格、Tab/Shift+Tab、Enter/Esc、浮窗和辅助窗口截图与 computed style 复核。
- 允许进入下一阶段的指令：无。阶段1仍需解锁后完成真实预览并由用户审阅；`state.json` 不代表批准。
- 这里不是最终版本发布批准；release 仍为 `not_ready`。

## 下一会话/恢复步骤

1. 在 Electron/LaunchServices 恢复后，确认没有正在使用正式数据的 Loop 窗口；不要删除或重置 `/Volumes/T7/work/personal-task-track/.local-review/frontend-remediation/stage-01/review-profile`。
2. 若 profile 中出现新的 `SingletonLock`、`SingletonSocket`、`SingletonCookie`，先把它们移入阶段1的本地备份目录，再启动：
   `LOOP_USER_DATA_DIR=/Volumes/T7/work/personal-task-track/.local-review/frontend-remediation/stage-01/review-profile npm run dev -- --remote-debugging-port=9590 --inspect=9591`
3. 用 `node .local-review/frontend-remediation/stage-01/review-foundation.cjs` 连接 9590/9591，生成 `main-{light,dark}-{1280,1024}.png`、`widget-{light,dark}.png`、`surface-{light,dark}.png`、`electron-baseline.json` 和 `review-ready.png`。
4. 真实检查至少包含：搜索默认/悬停/focus-within、普通对话框输入、任务改名、分组改名、简报、记录、知识源码/正文/表格单元格、菜单/listbox、禁用和错误状态；确认明暗主题无绿色输入边界，焦点仍可辨认，且无 pageerror/横向溢出。
5. 完成预览后，把 `state.json` 的阶段状态改为 `ready_for_review`，补 `completedAt`、`endHead`、`changedFiles`、`checks`、`preview`；再补本交接的真实截图表。不要写 `accepted`，不要启动阶段2。

## Git与版本

本阶段未提交、不升版本、不打标签、不推送、不发布。当前 HEAD 保持阶段0基线，工作区保留前阶段累计 dirty 改动以及本阶段待审阅修改。
