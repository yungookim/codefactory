import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { serveStatic } from "./static";

async function closeServer(server: Server) {
  server.closeAllConnections?.();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

test("serveStatic fallback serves index.html from hidden install paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), ".oh-my-pr-static-"));
  const distPath = path.join(root, "public");
  await mkdir(distPath, { recursive: true });
  await writeFile(path.join(distPath, "index.html"), "<!doctype html><title>oh-my-pr</title>", "utf8");

  const app = express();
  const server = createServer(app);

  try {
    serveStatic(app, root);

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected an ephemeral test server address");
    }

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/settings`);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /oh-my-pr/);
    } finally {
      await closeServer(server);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
