import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express, serverDir = __dirname) {
  const distPath = path.resolve(serverDir, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (_req, res) => {
    res.sendFile("index.html", { root: distPath });
  });
}
