# 执行阶段0：一次性整理基线与工作区

在固定工作区`/Volumes/T7/work/personal-task-track`执行。先读取`COMMON.md`、`state.json`、`DECISIONS.md`和总路线图阶段0；运行`node tools/frontend-remediation.cjs check 0`。本脚本不会自动执行，收到用户执行阶段0的指令后再开始。

## 目标

把这个现有工作区安全整理为后续所有会话共同使用的最新基线，登记一条整改分支。不要另建每阶段工作区，也不要现在实施后面的界面整改。

## 必须完成

1. 核对实际Git状态、HEAD、分支、worktree占用、origin地址和最新main/tags。旧记录`482912b`仅供识别，不能假定执行当天仍是最新。
2. 当前根目录在旧preserved分支且有旧编辑器等用户改动。形成带文件清单和校验值的备份，保存tracked差异、必要untracked源码/资料和已有暂存状态；说明备份能恢复哪些内容。执行包和共享状态也先另存校验，不能因stash/checkout失去接手指令。
3. 逐项区分：已进入远端的改动、应保留的用户工作、仅历史/演示资料和待判断冲突。不得`git reset --hard`、`git clean`、强推、整目录覆盖、丢弃stash或删除其他会话worktree。
4. 在这个工作区安全对齐最新origin/main，并创建/复用一条整改分支。默认可用`codex/frontend-remediation`；main在别处被检出时无需强占main。只有确实无法保留两边且影响范围无法判定时，给出具体文件差异和已备份证据后请求用户决定。
5. 将最终工作区、分支、真实基线commit和版本写入state。归档旧改动时保留可追溯路径，不把未归类内容静默删除或混入正式整改。
6. 核对当前设计参考：候选`source`、`DESIGN.md`、`direction.md`和`evidence/flat-editors`。登记8个候选差异文件及预览专属内容；本阶段不整包复制候选应用。
7. 建立功能/状态/三入口清单、隔离测试数据、适用检查和待补充性能基准。保留真实树、CodeMirror、区域复用与存储链路。

## 检查与交付

- 从整理后的同一工作区运行完整检查与必要基线专项；使用已验证的独立profile启动真实Electron。
- 记录原数据、原工作区与旧候选的保护情况，已知限制、依赖环境及macOS/Windows覆盖。
- 写`handoffs/STAGE-00.md`和跨阶段决策，阶段状态ready_for_review并清空activeStage。
- 未做阶段1界面修改，未提交、改版本或发布。下一会话必须沿用本阶段登记的分支和当前累计文件。
