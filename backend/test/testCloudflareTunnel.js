import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createTunnelManager } from "../src/services/cloudflare/tunnelService.js";

class FakeChild extends EventEmitter {
    constructor(pid = 1234) {
        super(); this.pid = pid; this.exitCode = null;
        this.stdout = new PassThrough(); this.stderr = new PassThrough(); this.kills = [];
    }
    kill(signal = "SIGTERM") { this.kills.push(signal); this.exitCode = 0; queueMicrotask(() => this.emit("close", 0, signal)); return true; }
}

const validUrl = "https://violet-bird.trycloudflare.com";
let child;
const manager = createTunnelManager({ spawnImpl: () => (child = new FakeChild()), startupTimeoutMs: 40, stopTimeoutMs: 30 });
const start = manager.startTunnel("http://127.0.0.1:3001", "deploy-success");
assert.deepEqual(child._ignored, undefined);
child.stderr.write(`2026-01-01 INF Your quick Tunnel has been created! Visit it at ${validUrl}\n`);
const running = await start;
assert.equal(running.status, "running");
assert.equal(running.publicUrl, validUrl);
assert.equal(running.deploymentId, "deploy-success");
assert.equal((await manager.startTunnel("http://127.0.0.1:3001", "deploy-success")).publicUrl, validUrl);
assert.equal(manager.getTunnelStatus("deploy-success").status, "running");
const stopped = await manager.stopTunnel("deploy-success");
assert.equal(stopped.status, "stopped");
assert.equal(child.kills[0], "SIGTERM");

const missing = createTunnelManager({ spawnImpl: () => { const errorChild = new FakeChild(); queueMicrotask(() => errorChild.emit("error", new Error("ENOENT"))); return errorChild; } });
assert.equal(await missing.checkCloudflaredInstalled(), false);
await assert.rejects(missing.startTunnel("http://127.0.0.1:3002", "missing"), /cloudflared failed to start/);
assert.equal(missing.getTunnelStatus("missing").status, "failed");

const timeoutChild = new FakeChild();
const timeoutManager = createTunnelManager({ spawnImpl: () => timeoutChild, startupTimeoutMs: 15, stopTimeoutMs: 20 });
await assert.rejects(timeoutManager.startTunnel("http://127.0.0.1:3003", "timeout"), /Timed out waiting/);
assert.equal(timeoutChild.kills.length, 1);

const exitChild = new FakeChild();
const exitManager = createTunnelManager({ spawnImpl: () => exitChild, startupTimeoutMs: 50 });
const exitingStart = exitManager.startTunnel("http://127.0.0.1:3004", "early-exit");
exitChild.emit("close", 1, null);
await assert.rejects(exitingStart, /exited before creating/);

const crashChild = new FakeChild();
const crashManager = createTunnelManager({ spawnImpl: () => crashChild, startupTimeoutMs: 50 });
const crashStart = crashManager.startTunnel("http://127.0.0.1:3005", "crash");
crashChild.stdout.write(`${validUrl}\n`);
await crashStart;
crashChild.exitCode = 1;
crashChild.emit("close", 1, null);
assert.equal(crashManager.getTunnelStatus("crash").status, "failed");
assert.equal(crashManager.getTunnelStatus("crash").publicUrl, null);
await assert.rejects(Promise.resolve().then(() => crashManager.startTunnel("http://localhost:3005", "invalid")), /only this deployment/);
await assert.rejects(Promise.resolve().then(() => crashManager.startTunnel("http://127.0.0.1:3005/path", "invalid-path")), /only this deployment/);

const allChild = new FakeChild();
const allManager = createTunnelManager({ spawnImpl: () => allChild, startupTimeoutMs: 50 });
const allStart = allManager.startTunnel("http://127.0.0.1:3010", "stop-all");
allChild.stderr.write(`${validUrl}\n`); await allStart;
const allStopped = await allManager.stopAllTunnels();
assert.equal(allStopped[0].status, "stopped");

console.log("PASS: Cloudflare tunnel executable, URL detection, timeout, process exits, duplicate/status handling, URL restrictions, and shutdown");
