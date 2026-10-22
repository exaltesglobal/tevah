import { describe, expect, it } from "vitest";
import { formatDuration, isOverdue, minutesToHours, parseDuration, reorder } from "../src/projects";

describe("parseDuration", () => {
  it.each([
    ["1:30", 90],
    ["0:45", 45],
    ["1h 30m", 90],
    ["1h30m", 90],
    ["2 hours", 120],
    ["1.5", 90],
    ["1.5h", 90],
    ["0.25", 15],
    ["90m", 90],
    ["45 min", 45],
    [" 3 ", 180],
  ])("%s is %i minutes", (input, minutes) => expect(parseDuration(input)).toBe(minutes));

  it.each(["", "0", "abc", "1:75", "25h", "-1", "1 day"])("rejects %j", (input) => expect(parseDuration(input)).toBeNull());
});

describe("formatDuration", () => {
  it("shows hours and minutes", () => {
    expect(formatDuration(90)).toBe("1h 30m");
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(0)).toBe("0m");
    expect(minutesToHours(100)).toBe(1.67);
  });
});

describe("reorder", () => {
  it("moves a task within a column", () => {
    expect(reorder(["a", "b", "c"], "c", 0)).toEqual([
      { id: "c", position: 1000 },
      { id: "a", position: 2000 },
      { id: "b", position: 3000 },
    ]);
  });
  it("adds a task arriving from another column, clamping the index", () => {
    expect(reorder(["a"], "x", 9).map((r) => r.id)).toEqual(["a", "x"]);
    expect(reorder([], "x", -1)).toEqual([{ id: "x", position: 1000 }]);
  });
});

describe("isOverdue", () => {
  it("counts only open tasks due before today", () => {
    expect(isOverdue({ status: "todo", dueDate: "2026-10-21" }, "2026-10-22")).toBe(true);
    expect(isOverdue({ status: "todo", dueDate: "2026-10-22" }, "2026-10-22")).toBe(false);
    expect(isOverdue({ status: "done", dueDate: "2026-10-01" }, "2026-10-22")).toBe(false);
    expect(isOverdue({ status: "todo", dueDate: null }, "2026-10-22")).toBe(false);
  });
});
