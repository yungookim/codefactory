import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { MemStorage } from "./memoryStorage";
import { registerRoutes } from "./routes";
import { _resetRingBufferForTests, logger } from "./logger";

async function createHarness() {
  const app = express();
  app.use(express.json());
  const server = createServer(app);
  await registerRoutes(server, app, {
    storage: new MemStorage(),
    startBackgroundServices: false,
    startWatcher: false,
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected ephemeral address");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      server.closeAllConnections?.();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => err ? reject(err) : resolve());
      });
    },
  };
}

async function flushLogs() {
  await new Promise((r) => setTimeout(r, 30));
}

test("GET /api/server-logs returns ring buffer records and known sources", async () => {
  _resetRingBufferForTests();
  const h = await createHarness();
  try {
    logger.info({ source: "babysitter" }, "first event");
    logger.warn({ source: "github" }, "warn event");
    logger.error({ source: "babysitter" }, "boom");
    await flushLogs();

    const res = await fetch(`${h.baseUrl}/api/server-logs`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      records: Array<{ msg: string; level: string; source?: string; seq: number }>;
      sources: string[];
      latestSeq: number;
    };

    const msgs = body.records.map((r) => r.msg);
    assert.ok(msgs.includes("first event"));
    assert.ok(msgs.includes("warn event"));
    assert.ok(msgs.includes("boom"));
    assert.deepEqual(body.sources.sort(), ["babysitter", "github"]);
    assert.ok(body.latestSeq > 0);
  } finally {
    await h.close();
  }
});

test("GET /api/server-logs filters by level", async () => {
  _resetRingBufferForTests();
  const h = await createHarness();
  try {
    logger.info("info-msg");
    logger.warn("warn-msg");
    logger.error("error-msg");
    await flushLogs();

    const res = await fetch(`${h.baseUrl}/api/server-logs?level=warn`);
    const body = (await res.json()) as { records: Array<{ msg: string; level: string }> };
    const msgs = body.records.map((r) => r.msg);
    assert.ok(!msgs.includes("info-msg"));
    assert.ok(msgs.includes("warn-msg"));
    assert.ok(msgs.includes("error-msg"));
  } finally {
    await h.close();
  }
});

test("GET /api/server-logs filters by source and search", async () => {
  _resetRingBufferForTests();
  const h = await createHarness();
  try {
    logger.info({ source: "alpha" }, "needle here");
    logger.info({ source: "beta" }, "no match");
    logger.info({ source: "alpha" }, "different message");
    await flushLogs();

    const sourceRes = await fetch(`${h.baseUrl}/api/server-logs?source=alpha`);
    const sourceBody = (await sourceRes.json()) as { records: Array<{ source?: string }> };
    assert.equal(sourceBody.records.length, 2);
    assert.ok(sourceBody.records.every((r) => r.source === "alpha"));

    const searchRes = await fetch(`${h.baseUrl}/api/server-logs?search=needle`);
    const searchBody = (await searchRes.json()) as { records: Array<{ msg: string }> };
    assert.equal(searchBody.records.length, 1);
    assert.match(searchBody.records[0].msg, /needle/);
  } finally {
    await h.close();
  }
});

test("GET /api/server-logs honors since cursor for pagination", async () => {
  _resetRingBufferForTests();
  const h = await createHarness();
  try {
    logger.info("one");
    logger.info("two");
    await flushLogs();

    const first = await (await fetch(`${h.baseUrl}/api/server-logs`)).json() as {
      records: Array<{ seq: number }>;
      latestSeq: number;
    };
    const cursor = first.latestSeq;

    logger.info("three");
    logger.info("four");
    await flushLogs();

    const tail = await (await fetch(`${h.baseUrl}/api/server-logs?since=${cursor}`)).json() as {
      records: Array<{ msg: string; seq: number }>;
    };
    const msgs = tail.records.map((r) => r.msg);
    assert.deepEqual(msgs, ["three", "four"]);
    assert.ok(tail.records.every((r) => r.seq > cursor));
  } finally {
    await h.close();
  }
});

test("GET /api/server-logs/stream emits new records as SSE events", async () => {
  _resetRingBufferForTests();
  const h = await createHarness();
  try {
    const ac = new AbortController();
    const res = await fetch(`${h.baseUrl}/api/server-logs/stream`, { signal: ac.signal });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/event-stream");
    assert.equal(res.headers.get("content-encoding"), "identity");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffered = "";

    const readUntil = async (predicate: (text: string) => boolean, timeoutMs = 1500) => {
      const start = Date.now();
      while (!predicate(buffered)) {
        if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting; buffer: ${buffered}`);
        const { value, done } = await reader.read();
        if (done) throw new Error("stream closed early");
        buffered += decoder.decode(value, { stream: true });
      }
    };

    // Allow the SSE handler to register subscriber before logging.
    await new Promise((r) => setTimeout(r, 30));
    logger.info({ source: "stream-test" }, "live-event-1");
    await readUntil((b) => b.includes("live-event-1"));

    logger.warn({ source: "stream-test" }, "live-event-2");
    await readUntil((b) => b.includes("live-event-2"));

    assert.match(buffered, /id: \d+/);
    assert.match(buffered, /data: \{.*"msg":"live-event-1"/);
    assert.match(buffered, /data: \{.*"msg":"live-event-2"/);

    ac.abort();
  } finally {
    await h.close();
  }
});

test("GET /api/server-logs/stream replays backlog when since is provided", async () => {
  _resetRingBufferForTests();
  const h = await createHarness();
  try {
    logger.info({ source: "backlog" }, "older-event-1");
    logger.info({ source: "backlog" }, "older-event-2");
    await flushLogs();

    const ac = new AbortController();
    const res = await fetch(`${h.baseUrl}/api/server-logs/stream?since=0`, { signal: ac.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffered = "";

    const start = Date.now();
    while (!(buffered.includes("older-event-1") && buffered.includes("older-event-2"))) {
      if (Date.now() - start > 1500) throw new Error(`timed out; buffer: ${buffered}`);
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
    }

    assert.match(buffered, /older-event-1/);
    assert.match(buffered, /older-event-2/);
    ac.abort();
  } finally {
    await h.close();
  }
});
