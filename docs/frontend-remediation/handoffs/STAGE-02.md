# 阶段02交接：导航与任务仓库

## 状态与现场

- 状态：`ready_for_review`。本阶段实现、专项、完整检查和真实 Electron 预览已完成，等待用户审阅；没有标记为 accepted。
- 工作区：`/Volumes/T7/work/personal-task-track`；唯一整改分支 `codex/frontend-remediation`；开始/结束 HEAD 均为 `482912b76c8666af849bbbdfd2ea806ba87bbaa4`；版本 `0.1.245`。
- 会话：`frontend-stage-02-20261027-root`，日期2026-10-27（Asia/Shanghai）。承接已有阶段2 in_progress 现场；核对没有旧阶段2进程后继续，未重建工作区/分支。
- 阶段0/1累计内容全部保留。`knowledge-watcher.cjs`、`prototypes/README.md` 与阶段0原件相同，`bridge.css` 与本阶段开工备份相同；foundation、知识、浮窗和历史原型未覆盖。
- 本阶段修改前的14个已有文件及后来必要修改的 `workspace.js` 共15文件备份在 `.local-review/frontend-remediation/stage-02/backup-resume-20261027/`，有逐文件 SHA-256 manifest；更早的 `backup-before/` 也保留。
- 实际预览窗口：**Loop · 阶段2导航与任务仓库（隔离数据）**。数据目录为工作区下 `.local-review/frontend-remediation/stage-02/review-profile`，只有合成数据；正式 `~/Library/Application Support/Personal Task Track` 未读写，用户其他窗口未关闭。

## 实际交付

- 新增 `app/renderer/src/repository.css`，只持有导航/任务仓库的表面、尺寸、分组滚动、标题省略和列表层次。今日入口保留深绿强调，普通导航和任务选择使用安静的中性色；44px单行任务、48px原生标题栏和原生控制预留继续沿用。
- 在 `index.html` 的 foundation 之前加载 repository；冻结 Demo CSS仍保持字节保护。搜索局部 `--field22-bg` 与共享 `--input-surface` 在同一容器解析，避免聚焦时从旧继承底色跳到新列表底色；焦点和透明输入继续由阶段1 foundation持有。
- `shell.js` 接通真实列表的范围内搜索：标题/简报/节点内容/速记匹配，明确当前范围的可访问名称与有效结果区域。处理中文组合输入提交、清空、无匹配、Escape、向下定位、任务行上下/Home/End，以及长/空标题和结果计数。移除不属于当前列表搜索的旧全局遮罩。
- `actions.js` / `app.js` 修复附加筛选范围：清除后保留今日、今日已完成、分组、未完成/全部/已完成；截止筛选不清空分组、不跨组取数。日期范围标签有独立、有效的清除动作；从日历/回顾进入仍保留返回上下文。主导航的任务仓库入口回到全部分组，列表状态页签保留当前分组。
- `bulk.js` 使用一次注册的事件代理，列表和结果反馈不用每次render重复绑定；overlay保留自身代理。范围变化在生成列表前清理多选，并把今日已完成状态纳入范围身份。保留真实批量动作、可完成/需处理结果和精确撤销；空标题在批量行仍可见。
- 收口overlay预设时间的重复监听；关闭overlay后在必要时针对新DOM恢复焦点。
- 必要跨阶段修改：`workspace.js` 的共享render焦点钩子给**导航/任务列表**补分组/任务/按钮值身份，避免所有 `select-nav-group` 都定位到首个分组。处理流/工作台继续使用原焦点分支；没有更改真实树、折叠、拖动、编辑器和存储。
- 更新三个UI专项为真实 Electron + 独立profile：`product-experience.ui.cjs`、`group-context-menu.ui.cjs`、`context-create.ui.cjs`，共用 `electron-ui-helpers.cjs`。旧分组测试已不再依赖正式界面不存在的 `.ops-app` / 旧分组选择器。
- 没有改schema、IPC、主进程窗口逻辑、依赖/锁文件、版本、处理流呈现或知识编辑器。

## 前阶段事项的承接与去向

| 来源阶段/文件 | 事项与接手时实际状态 | 本阶段处理与证据 | 结果/后续目标阶段 |
| --- | --- | --- | --- |
| 阶段0 D11、BASELINE“候选8文件迁入边界” | quiet-surface候选中的导航/列表几何归阶段2，不能整包迁入候选应用 | repository.css提取对应区域；index仅接入产品职责层；冻结样式专项通过 | 已完成 |
| 阶段1 D17/D18、handoff“样式所有者” | foundation持有中性焦点、透明原位输入、稳定搜索 | 复用末层foundation；修正新列表局部令牌解析；明暗默认/hover/focus及父容器computed style见electron-review.json | 本阶段区域已完成；其他入口完整预览仍属原阶段1/后续区域 |
| 阶段1交接“真实Electron阻塞” | check 2因阶段1blocked返回未满足 | 本轮用户明确要求执行阶段2；在允许桌面运行的权限下用npm run dev成功启动；原生Mac截图和运行时证明见native-mac-window.png、electron-review.json | 旧启动故障本次未复现；没有把阶段1改写为已验收。阶段1完整三窗口/全类别验证仍待补 |
| 阶段0 D10、stage1交接 | watcher轮询补偿及测试、历史原型需要保留 | 原件字节核对；watcher专项通过，未覆盖 | 已完成，后续保持 |
| 阶段0 BASELINE“旧编辑模式/页宽记忆” | 旧能力已归档，阶段4结合新实现判断 | 本阶段未恢复旧app/编辑器 | 仍待处理→阶段4 |
| 阶段0 BASELINE性能清单、stage1交接 | 300任务/3000节点及长笔记性能尚未验证 | 本阶段验证30分组、长标题、列表范围与实际长按排序；不把它当大树/笔记性能测试 | 仍待处理→阶段3/4 |
| 阶段1交接“今日/辅助窗口” | 完整跨窗行为不在阶段2 | 只共用foundation；没有改浮窗置顶/穿透/几何 | 仍待处理→阶段7 |

## 检查与证据

所有下列文件位于 `/Volumes/T7/work/personal-task-track/.local-review/frontend-remediation/stage-02/`。

| 检查 | 实际命令/操作 | 结果 | 日志/截图 | 限制 |
| --- | --- | --- | --- | --- |
| 前置 | `node tools/frontend-remediation.cjs status` / `check 2` | 目录/分支/HEAD正确；check 2仍报告阶段1blocked，未放宽工具或伪造验收 | preflight.log | 依本轮真实用户继续指令执行；此项不能写通过 |
| 阶段专项 | `node --test tests/window25-renderer.test.cjs tests/frontend-foundation.test.cjs tests/frontend-remediation.test.cjs tests/knowledge-watcher-polling.test.cjs` | 13/13，无跳过 | stage-tests.log | Windows标题栏为模拟几何/状态契约，不是原生Windows实测 |
| 产品交互 | `node tests/product-experience.ui.cjs` | 真实Electron通过：今日/仓库/分组/速记、状态/截止/清除范围、搜索/IME事件/键盘、改名错误、优先级/日期/循环、移动、长按排序、混合批量完成/跳过/撤销、日历/回顾返回、明暗与尺寸 | product-ui.log | IME为浏览器组合事件；未使用真人拼音输入法 |
| 分组交互 | `node tests/group-context-menu.ui.cjs` | 新增/改名/排序/整理搜索、右键及Shift+F10、外部关闭、Escape返回准确分组、独立profile落盘通过 | group-ui.log | 仅Mac |
| 创建回归 | `node tests/context-create.ui.cjs` | 真实空白区域新增、菜单优先级、空列表/空树、保留DOM/选择/滚动、重复bind及落盘重载通过 | context-ui.log | 不替代阶段3树完整验收 |
| 完整检查 | `npm run check` | 主测试347/347、服务测试12/12，无跳过，构建与语法检查通过 | npm-check.log | 没有发布构建 |
| CSS/设计 | PostCSS parse；Impeccable detector一次扫描 | CSS通过；检测结果 `[]` | css-parse.log、design-detect.json | 机械检查不代替截图与真实操作 |
| 空白/保护 | `git diff --check`，原件字节核对 | 通过；前阶段累计内容保留 | diff-check.log、preservation.json | 不清空dirty |
| 真实预览 | `LOOP_USER_DATA_DIR=<stage-02/review-profile> npm run dev -- --remote-debugging-port=9690 --inspect=9691` | appPath和userData核实；renderer无pageerror；正常/空/30分组/长标题、明暗1280/1024、折叠导航和透明原位编辑通过 | electron-review.json、electron-preview.log、main-{light,dark}-{1280,1024}.png、collapsed-*-1024.png、empty-*.png、many-groups-long-title.png、rename-error-*.png | Windows、多屏/DPI、其他macOS未实测 |
| 原生Mac窗口 | CUA读取真实窗口并截图；主进程窗口按钮位置核对 | 原生交通灯可见，不与品牌、导航按钮重叠；标题栏48px、drag/no-drag通过 | native-mac-window.png；electron-review.json（交通灯x9/y17） | renderer截图不冒充原生Windows |

### 排查与收敛记录

- 初始完整检查的两条静态断言仍描述旧“搜索全部”/全局遮罩；按实际的范围搜索契约更新断言，保留旧搜索函数的其余保护，并增加真实输入、结果、空态和键盘验证。
- 分组UI旧测试使用已经不存在的布局；改用真实navigation/management24，并在共用helper验证真实userData路径和落盘结果。
- 真实截图查出搜索局部令牌继承导致底色跳变、窄窗分组标题换行及普通导航hover恢复旧绿色；集中修正后确认明暗截图。
- 分组焦点错误定位到共享render只记录动作名；修复限定为导航/列表，不扩大到处理流焦点重构。
- 长按排序测试改用行内空白拖动区，等待正式拖动结束保护完成再操作；保留原排序实现。右键创建测试在测量后核对命中区域，保留真实右键路径。最终成功日志如表。

## 用户审阅

- 本轮真实用户原话：**“在 /Volumes/T7/work/personal-task-track 工作区，读取 docs/frontend-remediation/COMMON.md、state.json 及 STAGE-02.md，执行该阶段。沿用共享状态记录的同一工作区和整改分支，保留前阶段累计改动；只做本阶段，完成检查、真实本地预览和交接，不单独提交或发布。”**
- 这是阶段2执行及接手授权，不是阶段1/2产品验收，更不是最终发布授权；所有review仍pending。
- 已解决范围、搜索、重复绑定和焦点问题；真实候选已打开，普通状态/错误/禁用/空/长内容及明暗尺寸有证据。加载/持久化错误沿用既有反馈与完整测试，本阶段没有新增异步数据流程。
- 允许进入阶段3的真实用户指令：无。本阶段停在这里。

## 下一会话

- 先读COMMON、state、DECISIONS、BASELINE及本交接；按用户下一次明确指令执行。继续同一分支，勿reset/clean、重新迁入候选或逐阶段提交。
- 样式职责：repository仅导航/仓库几何，foundation最后持有控件/焦点；新区域不要重造绿色输入焦点。
- `workspace.js`新增的repository焦点身份分支必须保留；阶段3若调整共享钩子，应验证分组菜单返回和任务行键盘定位，不能退回只按动作名取首个元素。
- `shellBulkPrune`现在在主render生成列表前，`shellBindBulk`由稳定document代理一次安装；overlay仍独立持有自己的事件代理。
- 搜索是当前今日/仓库/分组范围内的任务/节点/速记查询；明确回到任务仓库可搜索全部分组。日历/回顾进入仍使用原返回上下文。
- 阶段1历史待补项、阶段3/4大树与长笔记性能、阶段4旧偏好判断、阶段7完整浮窗，以及原生Windows/多屏/DPI必须继续记录，不能在交接中静默丢弃。
- 当前预览用上述profile和端口；重启前核对已有实例与草稿，不碰正式目录。正常退出本阶段隔离窗口即可，勿关闭用户其他窗口。

## Git与版本

本阶段未提交、未升版本、未打标签、未推送、未构建发布包。HEAD和版本保持阶段0基线；累计dirty现场保留。具体改动文件、检查摘要与当前产品指纹见state阶段2记录及 `product-fingerprint.json`。
