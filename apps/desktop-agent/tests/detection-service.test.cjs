const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyWindow } = require("../services/detection-service.cjs");

test("classifies an active Teams meeting with high confidence", () => {
  assert.deepEqual(
    classifyWindow({ ProcessName: "ms-teams", MainWindowTitle: "Meeting with Maya | Microsoft Teams" }),
    {
      sourceApp: "Microsoft Teams",
      title: "Meeting with Maya | Microsoft Teams",
      confidence: "high",
      reason: "Teams meeting/call window detected"
    }
  );
});

test("classifies modern Teams windows without explicit meeting keyword as selectable", () => {
  assert.deepEqual(
    classifyWindow({ ProcessName: "MSTeams", MainWindowTitle: "Weekly Sync | Microsoft Teams" }),
    {
      sourceApp: "Microsoft Teams",
      title: "Weekly Sync | Microsoft Teams",
      confidence: "medium",
      reason: "Microsoft Teams window detected; confirm this is the active meeting"
    }
  );
});

test("ignores the Meet-X browser window", () => {
  assert.equal(classifyWindow({ ProcessName: "chrome", MainWindowTitle: "Meet-X - localhost:3001" }), null);
});

test("classifies Google Meet browser windows", () => {
  assert.equal(
    classifyWindow({ ProcessName: "msedge", MainWindowTitle: "Weekly sync - Google Meet" }).sourceApp,
    "Google Meet"
  );
});
test("does not treat the Teams calendar as an active call", () => {
  assert.equal(classifyWindow({ ProcessName: "ms-teams", MainWindowTitle: "Calendar | Meet-X | Microsoft Teams" }), null);
});

test("does not treat Teams chat as an active call", () => {
  assert.equal(classifyWindow({ ProcessName: "MSTeams", MainWindowTitle: "Chat | Microsoft Teams" }), null);
});
