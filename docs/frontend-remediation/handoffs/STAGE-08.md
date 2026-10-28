# 阶段08交接：整体收敛、远端整合与累计候选

## 状态与现场

- 阶段工作完成，`ready_for_review`。工作区 `/Volumes/T7/work/personal-task-track`，分支 `codex/frontend-remediation`，开始/阶段结束HEAD `3d70f475d42eb56b474f44effa06fceeb1d087dd`，阶段版本0.1.248。会话 `frontend-stage-08-20261027-root`，跨2026-10-27/28（Asia/Shanghai）。
- 初始`check 8`仅被阶段1历史blocked挡住；本阶段补齐真实主/今日/辅助入口、输入及原生外框后，把阶段1更新为ready_for_review。保留原始失败记录和审阅pending，没有填写人工验收。
- fetch及远端标签核对：origin/main与HEAD相同，包含阶段0以来已发布的0–4成果，无新增待合并源码。`release.remoteIntegratedCommit`登记3d70f47。main在`knowledge-release-fixes`工作区占用，未删除/重置/争用它。
- 修改前245文件复制并SHA校验，`stage-08/backup-before/manifest.json`；231份未受本阶段修改的文件保持一致，package/lock与前阶段累计实现保留。冻结Demo和历史原型原路径保留。
- 最终真实候选由同工作区`npm run dev -- --remote-debugging-port=10080 --inspect=10081`启动，独立profile为`.local-review/frontend-remediation/stage-08/review-profile`。窗口“Loop · 阶段8最终累计候选（隔离数据）”，实际PID、appPath/profile/几何见`final-runtime.json`。不要按应用名批量关闭其他实例。

## 实际交付

- foundation集中定义七个工作面明暗色值；repository与task/knowledge/temporal/system/widget职责层通过局部别名接入，移除重复暗色块。几何与局部范围保留，没有新增phase样式层或render包装。
- 真实computed style发现知识查找输入聚焦时被通用字段规则补底色；共享搜索规则现在覆盖默认/悬停/聚焦/键盘态，输入透明、父容器微色阶稳定，中性细线焦点保留。新增真实行为断言，检查两主题查找/替换的状态稳定性。
- 测试收敛：系统反馈测试等待产品既有的下一帧焦点恢复；知识搜索测试将证据/profile路径绝对化，并等待app.whenReady再核对真实身份，避免把启动前的Electron默认userData当成最终配置。没有修改生产存储或IPC。
- 保留已有区域/编辑器复用、简报会话、草稿/Undo、真实树/折叠/拖动和多窗生命周期。各render包装承担不同职责，未为减少数量而删除；Milkdown/notebook23仍有真实HTML、构建、导出/兼容测试引用，未误删。
- 全项目逐项覆盖、职责和平台边界见`../STAGE-08-COVERAGE.md`。仅产品CSS与三个必要UI测试有本阶段变化。

## 前阶段事项承接

| 来源 | 本阶段处理与证据 | 结果/去向 |
| --- | --- | --- |
| 阶段0基线/依赖/候选边界 | 同分支累积，SHA保护；真实独立node_modules，三包各16运行依赖；历史资料保留 | 完成 |
| 阶段1三入口、全输入及启动阻塞 | electron-review、workspace-review、inputs-supplement、search-confirm及知识/时间/设置/浮窗输入记录；native-main/menu真实截图 | 阻塞已补齐，ready_for_review；不冒称人工验收 |
| 阶段2范围/身份/bulk代理 | product/group/context真实回归 | 完成 |
| 阶段3树/草稿/连续性、大树 | task/node/menu/filter/continuity真实回归；performance-final/supplement/comparison | 功能通过；全展开成本继续作为已知P2性能限制 |
| 阶段4长笔记/文件/实际包 | knowledge-confirm、image、release-regressions；最终Mac实际包四套36场景 | 完成；只读注入/真实文件边界按套件明示 |
| 阶段5工作队列/日期/返回 | temporal9组、28布局＋模型/产品回归 | 完成；不改变原时间制度 |
| 阶段6恢复/反馈/焦点/系统状态 | system-final9组、36布局＋notification专项 | 自动化/实际本地IPC通过；通知授权、横幅和在线更新安装仍待真实平台人工检查 |
| 阶段7三窗/菜单D55 | widget11组、lifecycle真实退出重启、draft；原生菜单/主窗截图及AX树 | 本机单屏完成；Windows/跨屏DPI/人工IME见限制 |
| 各阶段原生Windows/多屏/DPI/人工IME | Mac双架构和Windows包、DPR模拟；没有对应物理环境 | 如实未测，集中保留，不伪造通过 |

## 检查与证据

证据根目录：`.local-review/frontend-remediation/stage-08/`。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| npm run check | 352主＋12服务测试通过，无跳过；编辑器/服务构建通过 | npm-check-final.log |
| foundation/remediation/watcher/notification专项 | 14通过，无跳过 | stage-tests-final.log |
| 累计UI组合 | 17套最终均通过；首轮树/浮窗单独复测，系统等待时序修正后通过；知识因本阶段搜索修复再次通过 | ui-results.json及各套日志；node-interactions-retry、widget-workspace-retry、system-settings-final、knowledge-confirm为最终结果 |
| 三入口/输入/明暗/字号/窄窗 | 主/今日/辅助真BrowserWindow；主窗两尺寸、透明原位编辑、父容器、中性焦点、空/错误/禁用/减少动效 | electron-review.json、workspace-review.json、inputs-supplement.json、search-confirm.json及各区域results |
| 原生外框/层级/辅助功能 | 工作区Electron路径成功绑定；菜单显示在父窗之上，Esc返回原按钮，主窗唤起；交通灯可见 | native-menu.png、native-main.png，CUA实际AX树 |
| Mac x64/arm64及Windows x64本地包 | 全通过，未签名Mac沿项目配置，publish never | build-mac-final.log、build-win-final.log |
| 三个包内源码/资源 | 每包176文件SHA等于工作区、各16运行依赖；88个静态入口引用存在，排除资料/日志 | package-source-proof.json |
| 实际Mac包知识回归 | desktop11＋conflict10＋feedback8＋search7＝36通过 | packaged-final.log及packaged-final各evidence |
| 更新摘要/资源清洁 | 2元数据、5摘要通过；12正式资产，另builder-debug为本地构建诊断；AppleDouble旁文件校验魔数后归档，release为0 | artifact-check.log、package-source-proof.json |
| CSS/空白/设计机械检查 | CSS解析、git diff --check通过；detector=[] | css-parse.json、diff-check.log、design-detect.json |

## 性能结果与解释

- 同阶段3数据、同机、1280×820：分散300任务/3000节点同步render中位约22.1ms；单任务全展开3000节点约334.2ms。全展开DOM41981，全收起3101；收起只剩10行，隐藏子树行0。
- 与阶段3历史19.55/276.8ms相比，本次观察更慢；不能直接归因于阶段8。增加同一进程/同数据交替加载阶段8开始CSS与最终CSS的对照：分散场景before22.8/21.9ms、after22.7/21.3ms；大树before322.6/311.5ms、after312.6/310.5ms。没有观察到本阶段CSS收敛引起的回退；也不声称跨阶段性能改善。
- 当前大树完整折叠/展开至两个rAF约465.7/554.1ms，冷启动至.app1149ms。GC后展开约17.71MB、收起16.28MB。滚动帧间隔中位约16.7ms，本次与历史约6.9ms的帧机会不同。两个rAF为绘制机会代理，不是物理屏幕端到端延迟。
- 600标题/21982字符笔记：同一编辑器/滚动保持，模式切换原文及Undo通过；打开约158.9ms，6次render至两个rAF约31.7–33.4ms，键盘API输入约89.7ms。没有同条件旧代码对照，不宣称提升。

## 排查与数据边界

- 原始包校验误把未在白名单的历史`renderer/assets`位置当漏包，核对真实`src/assets`引用和既有测试后改按打包白名单核实。外盘复制生成AppleDouble，已校验后归档，未改包字节。
- 最初packaged search查询发生在app就绪前且传相对profile，返回Electron临时默认userData后立即中止，未执行页面编辑操作；不能将该轮作为隔离验证通过。最终改绝对路径、whenReady后核对，四套全部通过；没有为核查而读写正式任务内容。
- 预览检查只使用合成数据。最终恢复可审阅种子前保存`profile-before-finalize.json`，不覆盖前阶段profile或正式目录。首次后台启动未留下实例，改持续会话启动成功；不把失败尝试写成留窗成功。

## 用户授权与后续发布

最初用户要求只执行阶段8、不提交发布；2026-10-28最新原话：**“继续，全部完成后发布新版本”**。该最新指令授权完成收尾后发布，覆盖原先停在阶段8的发布限制；不记录为用户已人工测试各平台。阶段8本身在版本0.1.248完成，随后进入RELEASE统一版本流程，发布结果另见`RELEASE.md`。

最终阶段产品指纹：`bc930560678f4f53c2dc29d300af374f01acd7d98ca96b557d9bed383c128767`（310文件）。版本元数据调整不改变此指纹。

## 限制与恢复

原生Windows/Intel运行、物理跨屏DPI、人工中文IME、VoiceOver/NVDA实际语音、通知授权/横幅、更新安装仍未在本机实测；Windows安装升级和跨平台知识门禁由后续远端工作流实际结果补充。若发布失败，保留所有候选、备份和累计源码，从RELEASE回执记录的准确步骤继续，禁止reset/clean或覆盖旧资料。
