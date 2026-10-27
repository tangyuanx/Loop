# Loop 前端整改：多会话串行执行包

这是一组给Codex会话执行的任务脚本。它们把整改范围、约束、检查和交接固化在仓库内，供不同会话顺序接手。配套命令工具只读取工作区、显示任务和检查前置条件，不自动修改界面、切分支、提交或推送。

## 工作方式

固定工作区：`/Volumes/T7/work/personal-task-track`。

阶段0安全整理一次基线后，阶段1–8始终在这个工作区、同一条整改分支累积修改。一次只运行一个修改会话。阶段之间不创建独立worktree，不重置到远端，不丢弃前阶段未提交成果。

0–8阶段不单独升版本、提交、打标签或推送。全部阶段结束后，在同一工作区完成远端整合、整体验收，再按`RELEASE.md`形成一个发布版本。这里的“合并”首先是同一份代码的连续累积，并不是每个会话各做一个分支再拼接。

2026-10-27用户追加要求“现在先把这几个阶段的工作发布一次新版本”，本次例外发布阶段0–4累计成果为v0.1.248。阶段5–8继续原串行安排，历史待验项保留，不因中途发布变为已完成。发布时补合入已经正式发布但尚未进入main的v0.1.246/247，避免功能回退；详情见`handoffs/RELEASE-0-4.md`及state.release。

## 给新会话的启动指令

把下面这段交给新会话，将`XX`替换为要执行的阶段编号（如`01`）：

```text
在 /Volumes/T7/work/personal-task-track 工作区，读取 docs/frontend-remediation/COMMON.md、state.json、DECISIONS.md、STAGE-XX.md、前阶段交接及与本阶段有关的更早交接，执行该阶段。阶段1–8同时读取BASELINE-STAGE-00.md，先核对并登记本阶段承接事项。沿用共享状态记录的同一工作区和整改分支，保留前阶段累计改动；只做本阶段，完成检查、真实本地预览和交接，不单独提交或发布。
```

也可以用`node tools/frontend-remediation.cjs prompt N`输出包含公共规则的阶段指令。该输出要求执行会话实际读取交接文件，不会自动把交接内容嵌入输出，也不会自动执行阶段。

## 执行顺序

| 编号 | 会话脚本 | 交付范围 |
| --- | --- | --- |
| 0 | [STAGE-00.md](STAGE-00.md) | 一次性安全整理基线与工作区 |
| 1 | [STAGE-01.md](STAGE-01.md) | 三个入口的全局基础与公共控件 |
| 2 | [STAGE-02.md](STAGE-02.md) | 导航、任务仓库、分组、搜索与批量 |
| 3 | [STAGE-03.md](STAGE-03.md) | 任务工作台、真实处理树与节点记录 |
| 4 | [STAGE-04.md](STAGE-04.md) | 知识工作区、编辑与文件状态 |
| 5 | [STAGE-05.md](STAGE-05.md) | 工作导航、日历与回顾 |
| 6 | [STAGE-06.md](STAGE-06.md) | 设置、恢复、提醒、帮助和反馈 |
| 7 | [STAGE-07.md](STAGE-07.md) | 今日浮窗与独立辅助窗口 |
| 8 | [STAGE-08.md](STAGE-08.md) | 整体收敛、远端整合与最终候选验收 |
| 发布 | [RELEASE.md](RELEASE.md) | 已验收版本的集中提交、版本与远程发布 |

详细设计范围仍以[总路线图](../architecture/FRONTEND_REMEDIATION_ROADMAP_20261026.md)为依据；这里补充跨会话执行机制。

## 常用命令

```sh
node tools/frontend-remediation.cjs status
node tools/frontend-remediation.cjs check 0
node tools/frontend-remediation.cjs prompt 0
node tools/frontend-remediation.cjs fingerprint
node tools/frontend-remediation.cjs check release
```

`check N`根据当时真实状态核对前置阶段、交接文件是否存在、工作区/分支和基线；结果以实际输出为准。它不验证交接内容是否已被执行会话理解，也不授予继续或发布许可。检查通过后仍须读取相关交接并核对真实文件和用户指令。

## 共享记录

- `state.json`：工作区、整改分支、基线、阶段状态、当前接手会话和最终验收记录。
- `handoffs/STAGE-XX.md`：每阶段实际改动、检查、预览、限制和下一阶段注意点，使用`HANDOFF-TEMPLATE.md`。
- `DECISIONS.md`：跨阶段设计与实现决策；新会话先读，避免重复推翻。
- `BASELINE-STAGE-00.md`：阶段0完成后的固定基线、备份恢复、依赖、候选迁入边界和功能/状态清单；阶段1–8持续读取。
- `.local-review/frontend-remediation/stage-XX/`：日志、截图、数据副本和必要文件备份。该目录已被Git忽略，不进入发布。

每阶段状态按`not_started → in_progress → ready_for_review → accepted`记录；遇到确实无法继续的问题可记`blocked`并写明原因。`ready_for_review`意味着实现和要求的检查完成、真实候选可审阅，不代表用户已经验收。记录用户明确的继续指令后可以进入下一阶段，不能代写用户批准。

如果会话中断，下一会话使用原阶段脚本恢复，不另建分支。先确认旧会话已停止修改，读取状态与交接，保留已完成部分再继续。

阶段进展以`state.json`和实际交接为准，不在本说明中固定“尚未开始”等会过期的状态。通常只更新本阶段交接、共享状态和跨阶段决策；阶段范围或出现新的具体依赖时才补充相应脚本，无需每完成一阶段就重写后续全部脚本。最终发布仍需对实际累计候选的明确验收和发布指令。
