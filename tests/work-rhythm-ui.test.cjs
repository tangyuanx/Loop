const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// The work & growth navigation is presented from the Demo's phase 15
// (loop-work-phase15.js/.css). work.js is the port; work.css is a byte-identical
// copy of the frozen baseline and is checked in desktop.test.cjs.
const root = path.resolve(__dirname, "..");
const js = fs.readFileSync(path.join(root, "app/renderer/src/work.js"), "utf8");
const css = fs.readFileSync(path.join(root, "app/renderer/src/work.css"), "utf8");
const model = fs.readFileSync(path.join(root, "app/renderer/src/work-navigation-model.js"), "utf8");
const html = fs.readFileSync(path.join(root, "app/renderer/index.html"), "utf8");

test("top navigation is the phase-15 pill mounted in the topbar actions", () => {
  assert.match(js, /work15-pill/);
  assert.match(js, /\.topbar \.shell-actions/);
  assert.match(js, /aria-label="工作与成长详情"/);
  assert.doesNotMatch(js, /work-rhythm-rail/);
  assert.match(css, /\.work15-pill\{margin-left:auto;margin-right:16px/);
});

test("settings advanced page carries the unlock gate and the schedule form", () => {
  assert.match(js, /work15-gate/);
  assert.match(js, /id="work15-unlock"/);
  assert.match(js, /work15-weekdays/);
  assert.match(js, /work15-time-grid/);
  assert.match(js, /id="work15-config"/);
  assert.match(js, /name="fridayMeetingStart"/);
  assert.match(js, /name="source"/);
  assert.match(css, /\.work15-time-grid\{display:grid;grid-template-columns:repeat\(4,minmax\(115px,1fr\)\)/);
  assert.match(css, /\.work15-gate\{margin-top:20px;max-width:440px/);
});

test("the dialog exposes the three tabs and the batch-import preview", () => {
  assert.match(js, /work15-tabbar/);
  assert.match(js, /\["current", "当前阶段"\]/);
  assert.match(js, /\["schedule", "全天安排"\]/);
  assert.match(js, /\["queue", "任务队列"\]/);
  assert.match(js, /work15-timeline/);
  assert.match(js, /work15-phase/);
  assert.match(js, /work15-preview/);
  assert.match(js, /data-work15-check/);
  assert.match(js, /data-work15-minutes/);
  assert.match(css, /\.work15-dialog\.dialog\{width:min\(700px/);
  assert.match(css, /\.work15-preview-summary\{display:flex;justify-content:space-between/);
});

test("the unlock uses the desktop password gate rather than a demo constant", () => {
  assert.match(js, /personalTaskTrack\?\.workRhythm/);
  assert.match(js, /verifyPassword/);
  assert.doesNotMatch(js, /=== *"demo"/);
});

test("work navigation goes through the project bridge, not a private copy", () => {
  assert.match(js, /globalThis\.LoopWorkNavigationBridge/);
  assert.match(js, /globalThis\.LoopWorkNavigationModel/);
  for (const call of ["snapshot()", "setRuntime(", "updateConfig(", "openTask(", "completeTask(", "blockTask(", "importTaskBatch(", "recoverTask("]) {
    assert.ok(js.includes(call), `work.js must use bridge.${call}`);
  }
  assert.doesNotMatch(js, /state\.tasks\.push/);
  assert.match(html, /work\.css\?v=[0-9.]+/);
  assert.match(html, /work\.js\?v=[0-9.]+/);
  assert.doesNotMatch(html, /work-rhythm\./);
});

test("the phase model stays the frozen Demo's loop-work-model.js", () => {
  const frozen = fs.readFileSync(
    path.join(root, "prototypes", "baseline", "loop-plane-phase17-frozen", "loop-work-model.js"),
    "utf8",
  );
  assert.equal(model, frozen, "work-navigation-model.js must stay byte-identical to the frozen loop-work-model.js");
});
