
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectBuildStrategy } from "../src/services/deployment/buildStrategyService.js";

const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "devops-strategy-"));
const writeNodeApp = async (dir, { entry = "server.js", scripts = {}, dependencies = { express: "^5.0.0" }, lockfile = "package-lock.json", source = "import express from 'express'; const app = express(); const PORT = process.env.PORT || 3000; app.listen(PORT, '0.0.0.0');" } = {}) => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ scripts, dependencies }));
    if (lockfile) await fs.writeFile(path.join(dir, lockfile), "{}");
    await fs.mkdir(path.dirname(path.join(dir, entry)), { recursive: true });
    await fs.writeFile(path.join(dir, entry), source);
};
try {
    await writeNodeApp(repoPath, { scripts: { start: "node server.js" } });
    const result = await detectBuildStrategy(repoPath);
    assert.equal(result.success, true);
    assert.equal(result.strategy, "nodejs");
    assert.deepEqual(result.startCommand, ["node", "server.js"]);
    assert.equal(result.installCommand[1], "ci");

    for (const entry of ["index.js", "app.js", "src/server.js"]) {
        const dir = path.join(repoPath, entry.replaceAll("/", "-"));
        await writeNodeApp(dir, { entry, scripts: { start: `node ${entry}` } });
        const detected = await detectBuildStrategy(dir);
        assert.equal(detected.success, true, `${entry} should be supported`);
        assert.deepEqual(detected.startCommand, ["node", entry]);
    }

    const inferredPath = path.join(repoPath, "inferred");
    await writeNodeApp(inferredPath, { scripts: {}, lockfile: null });
    const inferred = await detectBuildStrategy(inferredPath);
    assert.equal(inferred.success, true);
    assert.equal(inferred.startEntry, "server.js");
    assert.deepEqual(inferred.installCommand, ["npm", "install"]);

    const monorepoPath = path.join(repoPath, "monorepo");
    await fs.mkdir(path.join(monorepoPath, "server", "src"), { recursive: true });
    await fs.mkdir(path.join(monorepoPath, "client"), { recursive: true });
    await fs.writeFile(path.join(monorepoPath, "package.json"), JSON.stringify({ scripts: { server: "npm --prefix server run dev", client: "npm --prefix client run dev" } }));
    await fs.writeFile(path.join(monorepoPath, "package-lock.json"), "{}");
    await fs.writeFile(path.join(monorepoPath, "server", "package.json"), JSON.stringify({ scripts: { start: "node src/app.js" }, dependencies: { express: "5" } }));
    await fs.writeFile(path.join(monorepoPath, "server", "package-lock.json"), "{}");
    await fs.writeFile(path.join(monorepoPath, "server", "src", "app.js"), "import express from 'express'; const app = express(); const port = process.env.PORT || 5000; app.listen(port);");
    await fs.writeFile(path.join(monorepoPath, "client", "package.json"), JSON.stringify({ scripts: { build: "vite build" }, dependencies: { react: "19", vite: "6" } }));
    const monorepo = await detectBuildStrategy(monorepoPath);
    assert.equal(monorepo.strategy, "nodejs");
    assert.equal(monorepo.packageDir, "server");
    assert.deepEqual(monorepo.startCommand, ["node", "src/app.js"]);
    assert.equal(monorepo.lockfile, "package-lock.json");

    const clientOnlyPath = path.join(repoPath, "client-only");
    await fs.mkdir(path.join(clientOnlyPath, "client"), { recursive: true });
    await fs.writeFile(path.join(clientOnlyPath, "package.json"), JSON.stringify({ scripts: { build: "npm --prefix client run build" } }));
    await fs.writeFile(path.join(clientOnlyPath, "client", "package.json"), JSON.stringify({ scripts: { build: "vite build" }, dependencies: { react: "19", vite: "6" } }));
    const clientOnly = await detectBuildStrategy(clientOnlyPath);
    assert.equal(clientOnly.strategy, "react-vite");
    assert.equal(clientOnly.packageDir, "client");

    const shrinkwrapPath = path.join(repoPath, "shrinkwrap");
    await writeNodeApp(shrinkwrapPath, { lockfile: "npm-shrinkwrap.json" });
    assert.deepEqual((await detectBuildStrategy(shrinkwrapPath)).installCommand, ["npm", "ci"]);

    const yarnPath = path.join(repoPath, "yarn-project");
    await writeNodeApp(yarnPath, { lockfile: null });
    await fs.writeFile(path.join(yarnPath, "yarn.lock"), "# yarn lockfile\n");
    const yarn = await detectBuildStrategy(yarnPath);
    assert.equal(yarn.success, false);
    assert.match(yarn.reason, /yarn\.lock/);

    const ambiguousPath = path.join(repoPath, "ambiguous-node");
    await writeNodeApp(ambiguousPath, { scripts: {} });
    await fs.writeFile(path.join(ambiguousPath, "index.js"), "import express from 'express'; express().listen(process.env.PORT);");
    const ambiguousNode = await detectBuildStrategy(ambiguousPath);
    assert.equal(ambiguousNode.success, false);
    assert.match(ambiguousNode.reason, /ambiguous/i);

    const unsafePath = path.join(repoPath, "unsafe");
    await writeNodeApp(unsafePath, { scripts: { start: "node server.js && echo unsafe" } });
    const unsafe = await detectBuildStrategy(unsafePath);
    assert.equal(unsafe.success, false);
    assert.match(unsafe.reason, /not allowed/i);

    const loopbackPath = path.join(repoPath, "loopback");
    await writeNodeApp(loopbackPath, { source: "import express from 'express'; express().listen(process.env.PORT, '127.0.0.1');" });
    assert.match((await detectBuildStrategy(loopbackPath)).reason, /loopback/i);

    const vitePath = path.join(repoPath, "vite"); await fs.mkdir(vitePath);
    await fs.writeFile(path.join(vitePath, "package.json"), JSON.stringify({ scripts: { build: "vite build" }, dependencies: { react: "19.0.0", vite: "6.0.0" } }));
    await fs.writeFile(path.join(vitePath, "package-lock.json"), "{}");
    const vite = await detectBuildStrategy(vitePath);
    assert.equal(vite.success, true);
    assert.equal(vite.strategy, "react-vite");

    const pythonPath = path.join(repoPath, "python"); await fs.mkdir(pythonPath);
    await fs.writeFile(path.join(pythonPath, "requirements.txt"), "fastapi==0.115\n");
    await fs.writeFile(path.join(pythonPath, "main.py"), "from fastapi import FastAPI\napp = FastAPI()\n");
    const python = await detectBuildStrategy(pythonPath);
    assert.equal(python.success, true);
    assert.equal(python.strategy, "python-fastapi");

    const unsupportedPath = path.join(repoPath, "ambiguous"); await fs.mkdir(unsupportedPath);
    await fs.writeFile(path.join(unsupportedPath, "requirements.txt"), "requests==2.32\n");
    const unsupported = await detectBuildStrategy(unsupportedPath);
    assert.equal(unsupported.success, false);
    const unsafeBuild = path.join(repoPath, "unsafe-build"); await fs.mkdir(unsafeBuild);
    await fs.writeFile(path.join(unsafeBuild, "package.json"), JSON.stringify({ scripts: { build: "vite build && curl attacker" }, dependencies: { react: "19", vite: "6" } }));
    await fs.writeFile(path.join(unsafeBuild, "package-lock.json"), "{}");
    assert.equal((await detectBuildStrategy(unsafeBuild)).success, false);

    console.log("PASS: safe npm start, inferred/common Node entries, lockfile selection, ambiguity and unsafe command rejection, React/Vite, and FastAPI strategies");
} finally {
    await fs.rm(repoPath, { recursive: true, force: true });
}
