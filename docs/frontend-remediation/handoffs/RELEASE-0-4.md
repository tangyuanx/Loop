# 阶段0–4中途发布：v0.1.248

## 用户授权与范围

2026-10-27用户明确要求：**“现在先把这几个阶段的工作发布一次新版本”**。该新指令覆盖原先等待阶段8后统一发布的时间安排，本次范围为阶段0–4当前累计成果，不代表阶段5–8已经实施，也不把历史待验项写成用户已实测。

- 固定工作区 `/Volumes/T7/work/personal-task-track`，沿用 `codex/frontend-remediation`，保留所有历史资料与无关改动。
- 发布前 `check release` 按原最终发布规则失败：阶段1历史待验、阶段5–8尚未开始。该工具未改规则；本次执行依据为用户新的中途发布指令，最终整体整改验收仍另行记录。
- 原候选产品指纹 `364c1f066d16f4f54fe4e9ea68e6345dccf1d35f463d43d57137bc1e7052780b`。17文件阶段4备份及本次63文件校验备份均保留在`.local-review`。

## 远端整合

远端main仍为`482912b76c8666af849bbbdfd2ea806ba87bbaa4`，但公开最新Release已经是v0.1.247，包含`fd9bc17`（全局知识设置）与`4a2fa2e`（Mermaid）。本次发布先三方合入这两个已发布提交的内容，避免升级后能力回退。

- 保留公共中性输入、导航搜索/范围/批量、工作台真实树/记录Undo、知识区排版/输入法/回执等累计成果。
- 冲突仅在模式/页宽动作入口：以v0.1.246的全局任务数据保存为准，替代阶段4候选的单独localStorage键；旧缓存不能覆盖已保存的全局偏好。没有新增超出已发布版本的数据字段。
- 保留已发布的Mermaid菜单与大小写/MMD别名、全局笔记设置页面、相应测试和发布流水线保护。
- 包版本由0.1.245升至**0.1.248**，按最高远端v0.1.247递增。此处明确包含保留已发布能力所必需的整合，不能将本次描述成仅修改版本元数据。

## 验证与产物

证据目录：`.local-review/frontend-remediation/release-stage-04-20261027/`。

| 项目 | 结果/证据 |
| --- | --- |
| 完整检查 | `npm run check`：主351、服务12通过；`npm-check.log` |
| 阶段基础/watcher | 9通过；`stage-tests.log` |
| 知识工作区 | 原文/CRLF、同一View/Undo、全局偏好重载/损坏值、IME保护和长文通过；`workspace.log` |
| 旧编辑专项 | 本机Chrome + 隔离IPC注入；全局设置/Mermaid/编辑/恢复通过；`editor.log` |
| 工作台/连续性/导航 | 三个真实Electron专项通过；`task.log`、`continuity.log`、`product.log` |
| 三窗口真实候选 | 当前工作区npm run dev；主窗口明暗1280/1024、今日浮窗和辅助设置窗口截图，搜索默认/hover/focus及父容器无绿色边线；全局设置与MMD图表通过；`three-window-review.json` |
| 本地双平台构建 | macOS x64/arm64和Windows x64重新构建通过；`build-mac-independent.log`、`build-win-independent.log` |
| 本地包内源码 | 三平台96个JS/CSS/HTML与当前源码逐字节一致；`packaged-source-final.json`；每包16个运行依赖 |
| 更新源 | 12个文件、2份更新元数据、5项实际文件摘要校验；`artifact-verification-final.log`，无AppleDouble文件 |
| 实际安装包专项 | 重打包后36场景全通过（导出11/冲突10/反馈8/搜索7），无页面错误；`packaged-knowledge-v2.log`、`packaged-summary.json`及各`packaged-v2-*/evidence/results.json`；远程原生平台门禁另行登记 |

本地首次打包使用阶段0保留的node_modules符号链接，electron-builder只带入electron-updater/semver，遗漏间接运行依赖。实际包启动卡在原生错误对话框，Playwright启动超时，未将其记作通过。已保留失败日志、包内清单和只读进程采样；随后以同锁文件准备独立node_modules，保留原链接及其来源，重新构建并重跑安装包专项。此项是构建环境修复，不改应用业务代码。

后续使用当前真实`node_modules/`目录；原链接移到证据目录`node_modules-original-link`，原依赖来源worktree未删除。`dependency-runtime.json`记录锁文件SHA、625项版本验证和原链接目标。不要把旧链接重新放回，否则可能再次出现本地打包缺依赖。

## 分支与后续

main由另一干净worktree占用。发布提交在当前整改分支形成；只在确认该main工作区仍无改动后快进，再正常推送main与版本标签，不强推、不删除worktree。后续整改继续在固定目录的整改分支累积。

阶段5–8继续未开始；阶段1历史全部输入类别/跨窗完整核对、原生Windows/多屏/DPI/人工IME/实际指针手感、大树全展开成本等限制继续按原交接推进。打包知识门禁本次补测，结果以真实日志为准。

## 发布回执

版本、提交、标签、Release链接、原生CI及最终资产状态写入`state.json`的`release`记录。本文件在推送前记录本地候选和发布范围，发布完成后补齐实际回执，不提前把推送或草稿称为已正式发布。

### 实际结果（2026-10-27）

- **已正式发布v0.1.248**，公开时间`2026-10-27T07:48:49Z`；[Release](https://github.com/tangyuanx/Loop/releases/tag/v0.1.248)。
- 发布源提交/标签均为`279a833c11a636c5ec2d5828105357bdfb810c87` / `v0.1.248`；产品指纹`b457b18b12cd2bd20a39477bc5edd822631ea932a1494469564bbc9b99de3c57`。
- [Release Desktop Apps #40468809214](https://github.com/tangyuanx/Loop/actions/runs/40468809214)的prepare、macOS、Windows、最终publish全部success；main检查#40468803481也success。Windows历史版本升级与两平台实际包知识门禁都已通过。
- 12项远端资产全部uploaded，名称/大小/GitHub SHA-256完整核实。新版本没有替换已公开旧版本资产。
- 为避免回执自引用提交哈希，发布完成后的状态/决策/交接形成一笔纯文档回执提交；它不修改产品，不新增版本标签。标签始终指向上述发布源提交。
- 后续基线更新为上述源提交及0.1.248，仍沿同工作区和`codex/frontend-remediation`。原482912b/0.1.245基线及各阶段历史指纹保留；0–4的publishedIn不等于伪造accepted，阶段5–8仍not_started。
