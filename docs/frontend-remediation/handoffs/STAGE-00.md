# 阶段00交接：基线与整改边界

## 状态与现场

- 状态：`ready_for_review`。本阶段执行完成，尚无用户验收或进入阶段1的指令。
- 固定工作区：`/Volumes/T7/work/personal-task-track`。
- 整改分支：`codex/frontend-remediation`；后续阶段沿用，不另建worktree或重置累计内容。
- 开始HEAD：`4a16c1bad515bf39d24c76aa34a6d08b2b2eb059`；结束HEAD/基线：`482912b76c8666af849bbbdfd2ea806ba87bbaa4`。
- 会话标识：`frontend-stage-00-20261026-root`；日期2026-10-26，Asia/Shanghai。
- 接手时阶段0–8均未开始，没有前阶段累计产品成果。原preserved分支的用户编辑器工作有双补丁、原索引、1920文件SHA校验备份；归档可追溯，独立watcher补偿与历史资料继续保留。
- 当前打开真实Electron：由本工作区 `npm run dev -- --remote-debugging-port=9490 --inspect=9491` 启动；环境 `LOOP_USER_DATA_DIR=/Volumes/T7/work/personal-task-track/.local-review/frontend-remediation/stage-00/review-profile`。可识别窗口“Loop · 阶段0基线（隔离数据）”，浅色1280×820；同profile今日浮窗也保留。
- 原正式目录 `~/Library/Application Support/Personal Task Track` 未读写；未关闭既有其他profile窗口。空状态测试实例已关闭，profile和截图保留。不要按进程名批量退出Electron。

## 实际交付

- 在同工作区安全对齐最新origin/main，建立唯一整改分支，版本同步已有远端0.1.245。远端另有0.1.246/247标签，未据此决定本轮新版本。
- 新增 `docs/frontend-remediation/BASELINE-STAGE-00.md`：备份恢复边界、旧改动归类、候选8文件迁入边界、功能/状态/三入口清单、合成数据、检查与性能待补项。
- 更新 `state.json` 和 `DECISIONS.md`（D09–D15）；没有把执行授权写成accepted或发布批准。
- 保留 `app/main/knowledge-watcher.cjs` 的原外部卷轮询补偿，并从旧测试保留 `tests/knowledge-watcher-polling.test.cjs`。修正阶段工具测试fixture继承真实activeStage造成的场景污染，不更改检查保护条件。
- 17个tracked旧编辑器差异和73个untracked旧源码/资源/碰撞文件归档；完整列表在 `classification.json`/`transition-report.json`，原件在 `backup-original/files/`，移动件在 `archived-old-extra/`。旧编辑模式/页宽记忆等独特行为列为阶段4评估项，不声称完全等价。
- 原 `prototypes/README.md` 差异和全部旧Demo/研究资料原路径保留；执行包、只读工具、原规划资料不覆盖。没有复制候选应用或实施阶段1界面样式。
- 真实父子关系/折叠/拖动、区域复用、CodeMirror缓存、存储/IPC/Recovery均沿用main实现；未更换schema、编辑器或框架。

## 检查与证据

证据根目录：`/Volumes/T7/work/personal-task-track/.local-review/frontend-remediation/stage-00/`。

| 检查 | 实际命令/操作 | 结果 | 日志/截图路径 | 限制 |
| --- | --- | --- | --- | --- |
| 阶段前置 | `node tools/frontend-remediation.cjs status`、`check 0` | 通过 | `preflight-final.log` | 只读结果不是用户批准 |
| 专项 | `node --test tests/frontend-remediation.test.cjs tests/knowledge-watcher-polling.test.cjs` | 6/6通过，无跳过 | `stage-tests.log` | 原轮询清理用例；非原生外置盘压力测试 |
| 完整检查 | `npm run check` | 编辑器/服务构建，347主测试+12服务测试通过，无跳过 | `npm-check.log` | 首次旧依赖构建失败，锁文件核验运行时后完整重跑通过 |
| 空白/语法 | `git diff --check`及新增/保留脚本语法 | 通过 | `final-checks.log` | 未做发布构建 |
| 真实Electron主窗口 | native1280×820、1024×820，浅/深色，搜索焦点/Tab，树折叠，CodeMirror键盘输入与Undo | 通过基线运行检查，无pageerror、无页级横向溢出 | `electron-baseline.json`、`main-{light,dark}-{1280,1024}.png`、`knowledge-dark.png` | 不是阶段1设计验收；绿色搜索父容器焦点仍为既有缺陷 |
| 今日与辅助窗口 | 实际BrowserWindow，浅/深色今日和设置辅助窗 | 已截图核对 | `widget-{light,dark}.png`、`surface-{light,dark}.png` | 其他菜单/删除/多屏/穿透留阶段7 |
| 空数据 | 独立空profile实际Electron浅/深色 | 通过，无pageerror | `empty-preview.json`、`empty-{light,dark}.png` | 不代表其余异常状态已原生验证 |
| 原候选保护 | 原source/设计文档/最终flat-editors535文件SHA核对 | 全部未变 | `candidate-preservation.json` | 活动profile缓存由旧实例自身继续维护 |
| 初步性能 | 正常8任务/6节点，各12次同步render采样 | 切换P50/P95=4.6/5.3ms；搜索=3.8/5.3ms | `electron-baseline.json`、`environment.json` | 非端到端输入/绘制延迟；大树/长笔记/滚动待补 |

最终可审阅截图为 `review-ready.png`。全部截图来自真实本工作区Electron，不使用浏览器截图替代。

## 用户审阅

- 用户执行指令原话：“在 /Volumes/T7/work/personal-task-track 工作区，读取 docs/frontend-remediation/COMMON.md、state.json 及 STAGE-00.md，执行该阶段。沿用共享状态记录的同一工作区和整改分支，保留前阶段累计改动；只做本阶段，完成检查、真实本地预览和交接，不单独提交或发布。”
- 上述是本阶段执行授权；尚未收到对当前本地预览的验收反馈。
- 允许进入下一阶段的指令：无。未启动阶段1。
- 当前已知界面问题：搜索父 `.list-search:focus-within` 明暗均有绿色边线和底色跳变，阶段1必须全范围消除；本阶段保留真实基线，不把检查通过冒充设计已整改。
- 这里不是最终版本发布批准；release仍为not_ready，finalAcceptance为空。

## 下一会话

- 先读COMMON、state、DECISIONS、本交接、BASELINE-STAGE-00及用户指定下一阶段脚本；收到真实继续指令后运行对应check。
- 沿用当前工作区、分支、基线版本与累计改动；不要重新pull/reset、覆盖旧工作或创建新worktree。
- 保留原watcher补偿、独立用例、阶段工具fixture修复、执行包与所有研究/历史资料。候选仅按8文件职责取用，预览文字/主题按钮/合成任务不迁入正式产品。
- 当前 `node_modules` 链接到 `/Users/xuetangyuan/.codex/worktrees/knowledge-release-fixes/personal-task-track/node_modules`，625项锁文件版本一致；不要删除该依赖来源。原依赖目录完整保存在stage-00/dependencies-original，本地Git排除链接，后续勿提交它。
- 阶段3补300任务/3000节点的DOM/折叠/输入/滚动/拖动/内存基准；阶段4补长笔记、旧页宽/编辑模式记忆和真实文件故障。7类合成fixture已校验准备，不代表所有状态已原生实测。
- Windows原生、多屏、高DPI、安装器/打包未测试。阶段0不做安装包或远程构建。
- 首次自动审批拒绝后已补齐备份、精确分类和阶段0授权证据，经允许才完成切换，无残留阻断。细节及恢复指引在BASELINE-STAGE-00。

## Git与版本

- 当前版本0.1.245是同步远端既有基线，package与lock无本轮版本修改。
- 本阶段未创建提交、标签或推送，未发布或触发远程构建。HEAD保持482912b。
- 正常保留dirty累计现场；tracked差异为原watcher补偿和原prototypes/README，另有执行包、资料与本阶段测试等untracked文件，不能清空。
