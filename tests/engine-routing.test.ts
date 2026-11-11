import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { Engine } from "../src/backend/engine";
import type { Adapter, Project, Session, Settings, Snapshot } from "../src/shared/types";

test("domain registry uses live state across member, room, work, automation and data requests", async (t) => {
  const parent = path.resolve(process.env.TEMP!);
  const root = mkdtempSync(path.join(parent, "engine-routing-"));
  const directory = path.join(root, "project");
  mkdirSync(directory);
  const engine = new Engine(
    path.join(root, "data"),
    () => {},
    () => {},
    (id): Adapter => ({
      async probe() {
        return {
          id,
          name: id,
          available: true,
          auth: "subscription",
          detail: "isolated test",
          capabilities: {
            steer: false,
            cancel: "native",
            streaming: true,
            write: true,
            history: true,
          },
        };
      },
      async start() {
        throw new Error("No model requests allowed");
      },
      async stop() {},
    }),
    { maintenanceOnly: true },
  );
  t.after(async () => {
    await engine.close();
    assert.equal(path.dirname(root), parent);
    rmSync(root, { recursive: true, force: true });
  });
  engine.store.put("members", "tester", {
    id: "tester",
    name: "测试成员",
    executor: "codex",
    color: "#445566",
    motto: "",
  });
  await engine.invoke("provider.probe", { provider: "codex" });
  await engine.invoke("team.save", { member: { id: "tester", name: "修改后的成员" } });
  assert.equal(engine.store.members()[0].name, "修改后的成员");
  await engine.invoke("desk.open", { memberId: "tester" });
  const personal = await engine.invoke("room.get", { roomId: "desk:tester" });
  assert(personal);
  const project = (await engine.invoke("project.create", {
    directory,
    name: "注册表回归",
  })) as Project;
  const session = (await engine.invoke("session.create", {
    projectId: project.id,
    provider: "codex",
    title: "测试话题",
    memberId: "tester",
  })) as Session;
  assert.equal(session.projectId, project.id);
  await engine.invoke("automation.pause");
  const paused = (await engine.invoke("automation.list")) as Snapshot["automation"];
  assert.equal(paused?.paused, true);
  const settings = (await engine.invoke("settings.save", {
    settings: { maxParallel: 3 },
  })) as Settings;
  assert.equal(settings.maxParallel, 3);
  assert.equal(((await engine.invoke("snapshot")) as Snapshot).settings.maxParallel, 3);
  for (const method of ["member.missing", "constructor", "__proto__"]) {
    await assert.rejects(engine.invoke(method), /这个操作当前不可用/);
  }
  await engine.invoke("internal.restore.begin");
  await assert.rejects(
    engine.invoke("team.save", { member: { id: "tester", name: "不得保存" } }),
    /正在备份或恢复资料/,
  );
  assert.equal(((await engine.invoke("snapshot")) as Snapshot).settings.maxParallel, 3);
  await engine.invoke("internal.restore.cancel");
  assert.equal(engine.store.members()[0].name, "修改后的成员");
});
