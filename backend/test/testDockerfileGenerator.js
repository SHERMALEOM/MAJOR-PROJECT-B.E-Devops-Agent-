import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateDockerfile } from "../src/services/deployment/dockerfileGenerator.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "devops-dockerfile-"));
try {
    const nodePath = path.join(root, "node"); await fs.mkdir(nodePath);
    await fs.writeFile(path.join(nodePath, "package.json"), JSON.stringify({ scripts: { start: "node server.js" }, dependencies: { express: "5" } }));
    await fs.writeFile(path.join(nodePath, "package-lock.json"), "{}");
    await fs.writeFile(path.join(nodePath, "server.js"), "const express = require('express'); const app = express(); app.listen(process.env.PORT);");
    const node = await generateDockerfile(nodePath, { strategy: "nodejs", startEntry: "server.js", startCommand: ["node", "server.js"], readsPortFromEnvironment: true }, 4000);
    assert.equal(node.generated, true);
    const nodeDockerfile = await fs.readFile(path.join(nodePath, "Dockerfile"), "utf8");
    assert.match(nodeDockerfile, /RUN npm ci/);
    assert.match(nodeDockerfile, /ENV NODE_ENV=production HOST=0\.0\.0\.0 PORT=4000/);
    assert.match(nodeDockerfile, /CMD \["node","server\.js"\]/);
    assert.match(nodeDockerfile, /EXPOSE 4000/);
    assert.doesNotMatch(nodeDockerfile, /npm start/);
    assert.match(await fs.readFile(path.join(nodePath, ".dockerignore"), "utf8"), /\.env/);

    const unlockedPath = path.join(root, "unlocked-node"); await fs.mkdir(unlockedPath);
    await fs.writeFile(path.join(unlockedPath, "package.json"), "{}");
    await fs.writeFile(path.join(unlockedPath, "server.js"), "const http = require('http'); http.createServer().listen(3000);");
    await assert.rejects(() => generateDockerfile(unlockedPath, { strategy: "nodejs", startEntry: "server.js", startCommand: ["node", "server.js"], hardcodedPort: 3000 }, 8080), /configured container port/);
    await assert.rejects(() => generateDockerfile(unlockedPath, { strategy: "nodejs", startEntry: "server.js", startCommand: ["sh", "-c", "node server.js"], hardcodedPort: 3000 }, 3000), /Unsafe Node.js startup/);
    const unlocked = await generateDockerfile(unlockedPath, { strategy: "nodejs", startEntry: "server.js", startCommand: ["node", "server.js"], hardcodedPort: 3000 }, 3000);
    assert.match(await fs.readFile(path.join(unlockedPath, "Dockerfile"), "utf8"), /RUN npm install/);

    const monorepoPath = path.join(root, "monorepo");
    await fs.mkdir(path.join(monorepoPath, "server", "src"), { recursive: true });
    await fs.writeFile(path.join(monorepoPath, "server", "package.json"), JSON.stringify({ dependencies: { express: "5" } }));
    await fs.writeFile(path.join(monorepoPath, "server", "package-lock.json"), "{}");
    await fs.writeFile(path.join(monorepoPath, "server", "src", "app.js"), "const port = process.env.PORT; app.listen(port);");
    await generateDockerfile(monorepoPath, { strategy: "nodejs", packageDir: "server", startEntry: "src/app.js", startCommand: ["node", "src/app.js"], readsPortFromEnvironment: true }, 5000);
    const monorepoDockerfile = await fs.readFile(path.join(monorepoPath, "Dockerfile"), "utf8");
    assert.match(monorepoDockerfile, /COPY server\/package\*\.json \.\/server\//);
    assert.match(monorepoDockerfile, /WORKDIR \/app\/server/);
    assert.match(monorepoDockerfile, /CMD \["node","src\/app\.js"\]/);

    const reactPath = path.join(root, "react"); await fs.mkdir(reactPath);
    await fs.writeFile(path.join(reactPath, "package.json"), JSON.stringify({ scripts: { build: "vite build" } }));
    await fs.writeFile(path.join(reactPath, "package-lock.json"), "{}");
    await fs.writeFile(path.join(reactPath, "package.json"), JSON.stringify({ scripts: { build: "vite build && echo unsafe" } }));
    await assert.rejects(() => generateDockerfile(reactPath, { strategy: "react-vite" }, 4000), /exactly 'vite build'/);
    await fs.writeFile(path.join(reactPath, "package.json"), JSON.stringify({ scripts: { build: "vite build" } }));
    await generateDockerfile(reactPath, { strategy: "react-vite" }, 4173);
    const reactDockerfile = await fs.readFile(path.join(reactPath, "Dockerfile"), "utf8");
    assert.match(reactDockerfile, /nginx:1\.27-alpine/);
    assert.match(reactDockerfile, /RUN npm ci/);
    assert.match(reactDockerfile, /node_modules\/\.bin\/vite build/);
    assert.match(await fs.readFile(path.join(reactPath, "deploycraft.nginx.conf"), "utf8"), /listen 4173/);

    const pythonPath = path.join(root, "python"); await fs.mkdir(pythonPath);
    await generateDockerfile(pythonPath, { strategy: "python-fastapi", module: "main", application: "api" }, 8000);
    assert.match(await fs.readFile(path.join(pythonPath, "Dockerfile"), "utf8"), /uvicorn main:api/);

    const protectedPath = path.join(root, "existing"); await fs.mkdir(protectedPath);
    await fs.writeFile(path.join(protectedPath, "Dockerfile"), "FROM scratch\n");
    const preserved = await generateDockerfile(protectedPath, { strategy: "nodejs", startCommand: ["npm", "start"] });
    assert.equal(preserved.generated, false);
    assert.equal(await fs.readFile(path.join(protectedPath, "Dockerfile"), "utf8"), "FROM scratch\n");
    await assert.rejects(() => generateDockerfile(path.join(root, "invalid"), { strategy: "react-vite" }, 0), /port/i);
    console.log("PASS: safe Node startup, npm lockfile install selection, port/host configuration, React/Vite static serving, FastAPI, and Dockerfile preservation");
} finally {
    await fs.rm(root, { recursive: true, force: true });
}
