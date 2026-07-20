import assert from "node:assert/strict";
import test from "node:test";
import {
  pickRunnableTasks,
  selectTaskIds,
  validateTasks,
} from "../../tools/test-runner-lib.mjs";

const command = {command: "node", args: ["--version"]};

test("selects profile tasks with their transitive prerequisites", () => {
  const tasks = [
    {id: "setup", commands: [command]},
    {id: "compile", dependencies: ["setup"], commands: [command]},
    {id: "test", dependencies: ["compile"], commands: [command]},
    {id: "unrelated", commands: [command]},
  ];

  assert.deepEqual([...selectTaskIds(tasks, ["test"])], ["setup", "compile", "test"]);
});

test("only schedules ready tasks with non-conflicting resources", () => {
  const tasks = [
    {id: "setup", commands: [command], resources: ["frontend"]},
    {id: "native-a", dependencies: ["setup"], commands: [command], resources: ["port:1"]},
    {id: "native-b", dependencies: ["setup"], commands: [command], resources: ["port:1"]},
    {id: "reference", dependencies: ["setup"], commands: [command]},
  ];
  const selected = new Set(tasks.map(task => task.id));

  assert.deepEqual(
    pickRunnableTasks(tasks, selected, new Set(), new Set(), 4).map(task => task.id),
    ["setup"],
  );
  assert.deepEqual(
    pickRunnableTasks(
      tasks,
      new Set([...selected].filter(id => id !== "setup")),
      new Set(["setup"]),
      new Set(),
      4,
    ).map(task => task.id),
    ["native-a", "reference"],
  );
});

test("runs an exclusive task only when the worker pool is idle", () => {
  const tasks = [
    {id: "ordinary", commands: [command]},
    {id: "timing", exclusive: true, commands: [command]},
    {id: "later", commands: [command]},
  ];
  const pending = new Set(tasks.map(task => task.id));

  assert.deepEqual(
    pickRunnableTasks(tasks, pending, new Set(), new Set(), 4).map(task => task.id),
    ["ordinary", "later"],
  );
  assert.deepEqual(
    pickRunnableTasks(tasks, new Set(["timing"]), new Set(), new Set(), 4).map(task => task.id),
    ["timing"],
  );
  assert.deepEqual(
    pickRunnableTasks(
      tasks,
      new Set(["timing"]),
      new Set(),
      new Set(["runner:active"]),
      4,
    ),
    [],
  );
});

test("rejects duplicate ids, missing dependencies, and cycles", () => {
  assert.throws(
    () => validateTasks([
      {id: "same", commands: [command]},
      {id: "same", commands: [command]},
    ]),
    /duplicate task id/,
  );
  assert.throws(
    () => validateTasks([{id: "test", dependencies: ["missing"], commands: [command]}]),
    /unknown task/,
  );
  assert.throws(
    () => validateTasks([
      {id: "one", dependencies: ["two"], commands: [command]},
      {id: "two", dependencies: ["one"], commands: [command]},
    ]),
    /dependency cycle/,
  );
});
