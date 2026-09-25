import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HISTORY_ROOT = join(ROOT, ".codex-tmp", "live-editor-history");
const BACKUP_ROOT = join(ROOT, ".codex-tmp", "live-editor-backups");

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startPreview(port) {
  const child = spawn(process.execPath, ["tools/dev-server.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      SWC_API_ORIGIN: "http://127.0.0.1:9",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  const collect = (chunk) => { output += String(chunk); };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Local preview did not start.\n${output}`)), 15_000);
    const onData = () => {
      if (!output.includes("the six.well construct is running")) return;
      clearTimeout(timer);
      child.stdout.off("data", onData);
      resolve();
    };
    child.stdout.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Local preview exited with code ${code}.\n${output}`));
    });
  });
  return child;
}

async function stopPreview(child) {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  const result = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (!result && child.exitCode === null) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
}

async function postJson(origin, route, body) {
  const response = await fetch(`${origin}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  assert.equal(response.status, 200, `${route}: ${payload.error || response.statusText}`);
  return payload;
}

async function removeArtifactsForPath(root, pathname) {
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const artifactRoot = join(root, entry.name);
    try {
      const manifest = JSON.parse(await readFile(join(artifactRoot, "manifest.json"), "utf8"));
      if (manifest.pathname === pathname) await rm(artifactRoot, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

test("live-editor revisions survive restart and restore as new immutable revisions", { timeout: 45_000 }, async () => {
  const fixtureName = `live-editor-process-${process.pid}-${Date.now()}.html`;
  const fixturePath = join(ROOT, "tests", "fixtures", fixtureName);
  const pathname = `/tests/fixtures/${fixtureName}`;
  const original = '<main><p data-copy-id="process-copy">Original <strong>copy</strong></p><aside>Untargeted</aside></main>';
  const edited = "Updated <em>copy</em>";
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  let preview = null;

  await writeFile(fixturePath, original, "utf8");
  try {
    preview = await startPreview(port);
    const context = await postJson(origin, "/__tools/live-editor/context", { pathname });
    const applied = await postJson(origin, "/__tools/live-editor/apply", {
      pathname,
      edits: [{
        kind: "html",
        copyId: "process-copy",
        pathSegments: context.page.pathSegments,
        expectedHash: context.page.hash,
        html: edited,
        styles: { color: "#FCB867" },
      }],
    });
    assert.equal(applied.revisionNumber, 1);
    assert.match(await readFile(fixturePath, "utf8"), /style="color: #FCB867">Updated <em>copy<\/em>/);

    const firstHistory = await postJson(origin, "/__tools/live-editor/history", { pathname });
    assert.equal(firstHistory.revisions.length, 1);
    assert.equal(firstHistory.revisions[0].isOriginalBaseline, true);
    const firstRevisionId = firstHistory.revisions[0].id;
    const detail = await postJson(origin, "/__tools/live-editor/history/detail", { pathname, revisionId: firstRevisionId });
    assert.equal(detail.revision.files[0].edits[0].before.html, "Original <strong>copy</strong>");
    assert.equal(detail.revision.files[0].edits[0].after.html, edited);

    await stopPreview(preview);
    preview = await startPreview(port);
    const restartedHistory = await postJson(origin, "/__tools/live-editor/history", { pathname });
    assert.equal(restartedHistory.revisions[0].id, firstRevisionId);

    const restored = await postJson(origin, "/__tools/live-editor/history/restore", {
      pathname,
      revisionId: firstRevisionId,
      mode: "before",
    });
    assert.equal(restored.revisionNumber, 2);
    assert.equal(await readFile(fixturePath, "utf8"), original);

    const undone = await postJson(origin, "/__tools/live-editor/undo", { undoToken: restored.undoToken });
    assert.equal(undone.revisionNumber, 3);
    assert.match(await readFile(fixturePath, "utf8"), /Updated <em>copy<\/em>/);

    const restoredAgain = await postJson(origin, "/__tools/live-editor/history/restore", {
      pathname,
      revisionId: firstRevisionId,
      mode: "before",
    });
    assert.equal(restoredAgain.revisionNumber, 4);
    assert.equal(await readFile(fixturePath, "utf8"), original);

    const finalHistory = await postJson(origin, "/__tools/live-editor/history", { pathname });
    assert.deepEqual(
      finalHistory.revisions.map((revision) => revision.action),
      ["restore", "undo", "restore", "apply"]
    );
  } finally {
    await stopPreview(preview);
    await writeFile(fixturePath, original, "utf8").catch(() => {});
    await removeArtifactsForPath(HISTORY_ROOT, pathname);
    await removeArtifactsForPath(BACKUP_ROOT, pathname);
    await rm(fixturePath, { force: true });
  }
});
