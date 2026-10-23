import type { ServerConfig } from "./config.js";
import type { BugReport } from "./report.js";

export class GitHubIssueError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "GitHubIssueError";
  }
}

type GitHubIssue = { number: number; html_url: string };
type FetchLike = typeof globalThis.fetch;

const categoryLabels: Record<string, string> = {
  功能异常: "category:function",
  软件崩溃: "category:crash",
  数据异常: "category:data",
  界面显示: "category:ui",
  性能问题: "category:performance",
  功能建议: "category:suggestion",
  其他: "category:other",
};

export async function createGitHubIssue(
  report: BugReport,
  reportId: string,
  config: ServerConfig,
  fetchImpl: FetchLike = globalThis.fetch,
) {
  if (!config.githubToken) {
    throw new GitHubIssueError("SERVER_NOT_CONFIGURED", "反馈服务尚未配置 GitHub 凭据", 503);
  }

  const optionalLabel = categoryLabels[report.category];
  const labelAttempts = [
    ["bug", "from-app", optionalLabel].filter((label): label is string => Boolean(label)),
    ["bug", "from-app"],
    [],
  ];
  let lastError: GitHubIssueError | null = null;

  for (const labels of labelAttempts) {
    try {
      return await postIssue(report, reportId, labels, config, fetchImpl);
    } catch (error) {
      if (!(error instanceof GitHubIssueError) || error.code !== "GITHUB_VALIDATION_ERROR") throw error;
      lastError = error;
    }
  }
  throw lastError || new GitHubIssueError("GITHUB_ERROR", "GitHub Issue 创建失败", 502);
}

async function postIssue(
  report: BugReport,
  reportId: string,
  labels: string[],
  config: ServerConfig,
  fetchImpl: FetchLike,
) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.githubTimeoutMs);

  try {
    const response = await fetchImpl(
      `https://api.github.com/repos/${encodeURIComponent(config.githubOwner)}/${encodeURIComponent(config.githubRepo)}/issues`,
      {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${config.githubToken}`,
          "content-type": "application/json",
          "user-agent": "loop-bug-report-server",
          "x-github-api-version": "2022-11-28",
        },
        body: JSON.stringify({
          title: `[Bug][${report.category}] ${report.title}`,
          body: issueBody(report, reportId),
          ...(labels.length ? { labels } : {}),
        }),
        signal: controller.signal,
      },
    );
    const payload = await safeJson(response);
    if (!response.ok) throw mapGitHubError(response.status);
    if (!payload || !Number.isInteger(payload.number) || typeof payload.html_url !== "string") {
      throw new GitHubIssueError("GITHUB_INVALID_RESPONSE", "GitHub 返回了无效响应", 502);
    }
    return { issueNumber: payload.number as number, issueUrl: payload.html_url as string };
  } catch (error) {
    if (error instanceof GitHubIssueError) throw error;
    if (timedOut || (error as Error)?.name === "AbortError") {
      throw new GitHubIssueError("GITHUB_TIMEOUT", "GitHub API 请求超时", 504);
    }
    throw new GitHubIssueError("GITHUB_UNAVAILABLE", "GitHub API 暂时不可用", 502);
  } finally {
    clearTimeout(timeout);
  }
}

function issueBody(report: BugReport, reportId: string) {
  const environment = report.includeEnvironment && report.environment
    ? [
        `- 软件版本：${markdownText(report.environment.appVersion)}`,
        `- 操作系统：${markdownText(report.environment.os)}`,
        `- 系统架构：${markdownText(report.environment.architecture)}`,
        `- 当前页面：${markdownText(report.environment.currentPage)}`,
        `- 安装标识：${markdownText(report.environment.installationId)}`,
        `- 提交时间：${markdownText(report.environment.submittedAt)}`,
      ].join("\n")
    : "未附带。";
  return [
    "## 问题描述",
    "",
    markdownText(report.description),
    "",
    "## 复现步骤",
    "",
    markdownText(report.reproductionSteps || "未提供。"),
    "",
    "## 环境信息",
    "",
    environment,
    `- 反馈编号：${reportId}`,
    "",
    "## 联系信息",
    "",
    markdownText(report.contact || "未提供。"),
    "",
    "> 此 Issue 由应用内 Bug 反馈功能自动创建。",
  ].join("\n");
}

function markdownText(value: string) {
  return value.replaceAll("<", "&lt;").replaceAll(">", "&gt;").replace(/^#/gm, "\\#");
}

async function safeJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mapGitHubError(status: number) {
  if (status === 401) return new GitHubIssueError("GITHUB_AUTH_ERROR", "GitHub 凭据无效", 502);
  if (status === 403) return new GitHubIssueError("GITHUB_FORBIDDEN", "GitHub 拒绝了 Issue 创建请求", 502);
  if (status === 422) return new GitHubIssueError("GITHUB_VALIDATION_ERROR", "GitHub 无法处理 Issue 内容或标签", 502);
  return new GitHubIssueError("GITHUB_ERROR", "GitHub Issue 创建失败", 502);
}
