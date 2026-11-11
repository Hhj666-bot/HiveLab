import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { SingleFlightPump } from "../src/backend/pump";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("pump coalesces bursts and preserves a wakeup during an active scan", async () => {
  const gate = deferred();
  let calls = 0,
    active = 0,
    maximum = 0;
  const pump = new SingleFlightPump(
    async () => {
      active++;
      maximum = Math.max(maximum, active);
      if (++calls === 1) await gate.promise;
      active--;
    },
    () => true,
  );
  for (let i = 0; i < 20; i++) pump.request();
  await setImmediate();
  assert.equal(calls, 1);
  for (let i = 0; i < 20; i++) pump.request();
  gate.resolve();
  await setImmediate();
  assert.equal(calls, 2);
  assert.equal(maximum, 1);
  assert.equal(pump.busy, false);
  await pump.close();
});

test("pump retains a wakeup between loop completion and promise cleanup", async () => {
  let calls = 0;
  const pump = new SingleFlightPump(
    async () => {
      if (++calls === 1) queueMicrotask(() => queueMicrotask(() => pump.request()));
    },
    () => true,
  );
  pump.request();
  await setImmediate();
  assert.equal(calls, 2);
  await pump.close();
});

test("pump close joins the active scan and suppresses queued and future scans", async () => {
  const gate = deferred();
  let calls = 0,
    closed = false;
  const pump = new SingleFlightPump(
    async () => {
      calls++;
      await gate.promise;
    },
    () => true,
  );
  pump.request();
  await setImmediate();
  pump.request();
  const closing = pump.close().then(() => {
    closed = true;
  });
  await setImmediate();
  assert.equal(closed, false);
  gate.resolve();
  await closing;
  pump.request();
  await setImmediate();
  assert.equal(calls, 1);
  assert.equal(pump.busy, false);
});

test("failed or unavailable scans are not automatically replayed", async () => {
  let calls = 0,
    available = false;
  const pump = new SingleFlightPump(
    async () => {
      calls++;
      throw new Error("scan failed");
    },
    () => available,
  );
  pump.request();
  await setImmediate();
  assert.equal(calls, 0);
  available = true;
  pump.request();
  await setImmediate();
  assert.equal(calls, 1);
  assert.equal(pump.busy, false);
  pump.request();
  await setImmediate();
  assert.equal(calls, 2);
  await pump.close();
});
