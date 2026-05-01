import express, { type Express } from "express";
import { rateLimit } from "express-rate-limit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const staticFallbackLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
});

function getDefaultServerDir() {
  return typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
}

export function serveStatic(app: Express, serverDir = getDefaultServerDir()) {
  const distPath = path.resolve(serverDir, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", staticFallbackLimiter, (_req, res) => {
    res.sendFile("index.html", { root: distPath });
  });
}
