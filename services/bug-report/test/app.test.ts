import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig, type ServerConfig } from "../src/config.js";
import { buildApp } from "../src/app.js";

const validPayload = {
  title: "新增任务后列表没有刷新",
  category: "功能异常",
  description: "点击保存后提示成功，但任务列表没有显示新任务。",
  reproductionSteps: "1. 新建任务\n2. 点击保存",
  contact: "tester@example.com",
  includeEnvironment: true,
  environment: {
    appVersion: "1.0.0",
    os: "Windows 11",
    architecture: "x64",
    currentPage: "Task Flow",
    installationId: "123e4567-e89b-42d3-a456-426614174000",
    submittedAt: "2026-08-09T08:00:00.000Z",
  },
};

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    githubToken: "test-token",
    githubOwner: "tangyuanx",
    githubRepo: "Loop",
    port: 3000,
    allowedOrigins: new Set(),
    bodyLimit: 100 * 1024,
    rateLimitMax: 5,
    rateLimitWindowMs: 60 * 60 * 1000,
    githubTimeoutMs: 100,
    ...overrides,
  };
}

function githubResponse(status = 201, body: Record<string, unknown> = { number: 38, html_url: "https://github.com/tangyuanx/Loop/issues/38" }) {
  return async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("normal submission creates a GitHub Issue and returns a report receipt", async (t) => {
  let requestBody: Record<string, unknown> | undefined;
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(_url), "https://api.github.com/repos/tangyuanx/Loop/issues");
    assert.match(String((init?.headers as Record<string, string>).authorization), /^Bearer /);
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ number: 38, html_url: "https://github.com/tangyuanx/Loop/issues/38" }), { status: 201 });
  };
  const app = buildApp({ config: config(), fetchImpl: fetchImpl as typeof fetch });
  t.after(() => app.close());

  const response = await app.inject({ method: "POST", url: "/api/bug-reports", payload: validPayload });
  assert.equal(response.statusCode, 201);
  assert.match(response.json().reportId, /^BR-\d{8}-[A-F0-9]{6}$/);
  assert.equal(response.json().issueNumber, 38);
  assert.match(String(requestBody?.title), /^\[Bug\]\[功能异常\]/);
  assert.match(String(requestBody?.body), /反馈编号：BR-/);
  assert.doesNotMatch(String(requestBody?.body), /Authorization/i);
});

test("repository rename keeps existing feedback deployments pointed at Loop", () => {
  assert.equal(loadConfig({}).githubRepo, "Loop");
  assert.equal(loadConfig({ GITHUB_OWNER: "tangyuanx", GITHUB_REPO: "personal-task-track" }).githubRepo, "Loop");
  assert.equal(loadConfig({ GITHUB_OWNER: "another-owner", GITHUB_REPO: "personal-task-track" }).githubRepo, "personal-task-track");
  assert.equal(loadConfig({ GITHUB_OWNER: "tangyuanx", GITHUB_REPO: "custom-repo" }).githubRepo, "custom-repo");
});

test("request validation rejects empty title, short description, and oversized fields", async (t) => {
  const app = buildApp({ config: config(), fetchImpl: githubResponse() as typeof fetch });
  t.after(() => app.close());
  const cases = [
    [{ ...validPayload, title: "" }, "问题标题"],
    [{ ...validPayload, description: "太短" }, "问题描述"],
    [{ ...validPayload, title: "标".repeat(101) }, "问题标题"],
    [{ ...validPayload, reproductionSteps: "步".repeat(5001) }, "复现步骤"],
    [{ ...validPayload, contact: "a".repeat(201) }, "联系方式"],
  ] as const;
  for (const [payload, message] of cases) {
    const response = await app.inject({ method: "POST", url: "/api/bug-reports", payload });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, "INVALID_REQUEST");
    assert.match(response.json().message, new RegExp(message));
  }
});

test("request bodies larger than 100KB are rejected before processing", async (t) => {
  const app = buildApp({ config: config(), fetchImpl: githubResponse() as typeof fetch });
  t.after(() => app.close());
  const response = await app.inject({
    method: "POST",
    url: "/api/bug-reports",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ ...validPayload, description: "a".repeat(110 * 1024) }),
  });
  assert.equal(response.statusCode, 413);
  assert.equal(response.json().code, "PAYLOAD_TOO_LARGE");
});

test("missing GitHub token returns a sanitized configuration error", async (t) => {
  const app = buildApp({ config: config({ githubToken: "" }), fetchImpl: githubResponse() as typeof fetch });
  t.after(() => app.close());
  const response = await app.inject({ method: "POST", url: "/api/bug-reports", payload: validPayload });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { success: false, code: "SERVER_NOT_CONFIGURED", message: "反馈服务尚未配置" });
});

for (const status of [401, 403, 422]) {
  test(`GitHub ${status} is mapped to a safe error response`, async (t) => {
    const app = buildApp({ config: config(), fetchImpl: githubResponse(status, { message: "sensitive upstream detail" }) as typeof fetch });
    t.after(() => app.close());
    const response = await app.inject({ method: "POST", url: "/api/bug-reports", payload: validPayload });
    assert.equal(response.statusCode, 502);
    assert.equal(response.json().success, false);
    assert.doesNotMatch(response.body, /sensitive upstream detail|test-token/);
  });
}

test("GitHub timeout returns a unified timeout error", async (t) => {
  const fetchImpl = (_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  const app = buildApp({ config: config({ githubTimeoutMs: 20 }), fetchImpl: fetchImpl as typeof fetch });
  t.after(() => app.close());
  const response = await app.inject({ method: "POST", url: "/api/bug-reports", payload: validPayload });
  assert.equal(response.statusCode, 504);
  assert.equal(response.json().code, "GITHUB_TIMEOUT");
});

test("missing optional category label falls back without losing the Issue", async (t) => {
  const requestBodies: Array<{ labels?: string[] }> = [];
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    requestBodies.push(JSON.parse(String(init?.body)));
    if (requestBodies.length === 1) return new Response(JSON.stringify({ message: "label missing" }), { status: 422 });
    return new Response(JSON.stringify({ number: 41, html_url: "https://github.com/tangyuanx/Loop/issues/41" }), { status: 201 });
  };
  const app = buildApp({ config: config(), fetchImpl: fetchImpl as typeof fetch });
  t.after(() => app.close());
  const response = await app.inject({ method: "POST", url: "/api/bug-reports", payload: validPayload });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().issueNumber, 41);
  assert.deepEqual(requestBodies[0]?.labels, ["bug", "from-app", "category:function"]);
  assert.deepEqual(requestBodies[1]?.labels, ["bug", "from-app"]);
});

test("rapid duplicate submissions are limited to five per IP per hour", async (t) => {
  const app = buildApp({ config: config(), fetchImpl: githubResponse() as typeof fetch });
  t.after(() => app.close());
  for (let index = 0; index < 5; index += 1) {
    const response = await app.inject({ method: "POST", url: "/api/bug-reports", payload: validPayload });
    assert.equal(response.statusCode, 201);
  }
  const blocked = await app.inject({ method: "POST", url: "/api/bug-reports", payload: validPayload });
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.json().code, "RATE_LIMITED");
});

test("CORS rejects unknown browser origins but permits allowlisted origins", async (t) => {
  const app = buildApp({ config: config({ allowedOrigins: new Set(["https://app.example.com"]) }), fetchImpl: githubResponse() as typeof fetch });
  t.after(() => app.close());
  const denied = await app.inject({ method: "GET", url: "/health", headers: { origin: "https://evil.example" } });
  assert.equal(denied.statusCode, 403);
  const allowed = await app.inject({ method: "GET", url: "/health", headers: { origin: "https://app.example.com" } });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.headers["access-control-allow-origin"], "https://app.example.com");
});
