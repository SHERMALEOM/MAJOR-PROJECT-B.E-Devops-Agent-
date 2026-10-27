import { spawn } from "node:child_process";

const QUICK_TUNNEL_HOST = "trycloudflare.com";
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;

const validateServiceUrl = value => {
    let url;
    try { url = new URL(value); } catch { throw new Error("Tunnel target must be a valid local HTTP URL"); }
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || url.search || url.hash || !/^\/$/.test(url.pathname) || !url.port) {
        throw new Error("Quick Tunnels may target only this deployment's http://127.0.0.1:<port> service");
    }
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Tunnel target port is invalid");
    return url.href;
};

const extractPublicUrl = text => {
    const match = String(text).match(/https:\/\/([a-z0-9-]+\.trycloudflare\.com)(?::443)?\b/i);
    if (!match) return null;
    const url = new URL(`https://${match[1].toLowerCase()}`);
    if (url.protocol !== "https:" || url.hostname === QUICK_TUNNEL_HOST || !url.hostname.endsWith(`.${QUICK_TUNNEL_HOST}`)) return null;
    return url.origin;
};

const snapshot = record => ({ deploymentId: record.deploymentId, serviceUrl: record.serviceUrl, publicUrl: record.status === "running" ? record.publicUrl : null, status: record.status, pid: record.pid, error: record.error, startedAt: record.startedAt });

export const createTunnelManager = ({
    spawnImpl = spawn,
    command = process.env.CLOUDFLARED_PATH || "cloudflared",
    startupTimeoutMs = Number(process.env.CLOUDFLARE_TUNNEL_START_TIMEOUT_MS || DEFAULT_STARTUP_TIMEOUT_MS),
    stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS
} = {}) => {
    const tunnels = new Map();

    const stopRecord = async record => {
        if (!record.child || record.status === "stopped" || (record.status === "failed" && record.exited)) {
            record.status = "stopped";
            return snapshot(record);
        }
        record.status = "stopping";
        await new Promise(resolve => {
            let settled = false;
            const finish = () => { if (settled) return; settled = true; clearTimeout(timer); resolve(); };
            const timer = setTimeout(() => { try { record.child.kill("SIGKILL"); } catch {} finish(); }, stopTimeoutMs);
            record.child.once("close", finish);
            try { record.child.kill("SIGTERM"); } catch { finish(); }
        });
        record.status = "stopped";
        record.publicUrl = null;
        return snapshot(record);
    };

    const manager = {
        async checkCloudflaredInstalled() {
            return new Promise(resolve => {
                let child;
                try { child = spawnImpl(command, ["--version"], { windowsHide: true, stdio: ["ignore", "ignore", "ignore"], shell: false }); }
                catch { resolve(false); return; }
                let done = false;
                const finish = result => { if (done) return; done = true; clearTimeout(timer); resolve(result); };
                const timer = setTimeout(() => { try { child.kill(); } catch {} finish(false); }, 5000);
                child.once("error", () => finish(false));
                child.once("close", code => finish(code === 0));
            });
        },

        startTunnel(serviceUrl, deploymentId) {
            if (typeof deploymentId !== "string" || !deploymentId.trim() || deploymentId.length > 128) throw new Error("A valid deployment ID is required for a tunnel");
            const targetUrl = validateServiceUrl(serviceUrl);
            const key = deploymentId.trim();
            const existing = tunnels.get(key);
            if (existing && ["starting", "running", "stopping"].includes(existing.status)) {
                if (existing.serviceUrl !== targetUrl) throw new Error("A tunnel already exists for this deployment with a different service URL");
                if (existing.status === "running") return Promise.resolve({ ...manager.getTunnelStatus(key) });
                if (existing.startPromise) return existing.startPromise;
                throw new Error(`Tunnel for deployment is ${existing.status}`);
            }

            const record = { deploymentId: key, serviceUrl: targetUrl, publicUrl: null, status: "starting", pid: null, child: null, exited: false, error: null, startedAt: null, startPromise: null };
            tunnels.set(key, record);
            record.startPromise = new Promise((resolve, reject) => {
                let settled = false;
                let output = "";
                let timer;
                const fail = async error => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    record.status = "failed";
                    record.error = error.message;
                    try {
                        if (record.child && !record.exited) {
                            record.child.kill("SIGTERM");
                            const forceKill = setTimeout(() => { if (!record.exited) { try { record.child.kill("SIGKILL"); } catch {} } }, 1000);
                            forceKill.unref?.();
                        }
                    } catch {}
                    reject(error);
                };
                try {
                    record.child = spawnImpl(command, ["tunnel", "--no-autoupdate", "--url", targetUrl], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], shell: false });
                    record.pid = record.child.pid || null;
                } catch (error) { void fail(new Error(`Could not start cloudflared: ${error.message}`)); return; }
                const onOutput = chunk => {
                    output = `${output}${chunk}`.slice(-64 * 1024);
                    const publicUrl = extractPublicUrl(output);
                    if (!settled && publicUrl) {
                        settled = true;
                        clearTimeout(timer);
                        record.publicUrl = publicUrl;
                        record.status = "running";
                        record.startedAt = new Date();
                        resolve({ ...manager.getTunnelStatus(key) });
                    }
                };
                record.child.stdout?.on("data", onOutput);
                record.child.stderr?.on("data", onOutput);
                record.child.once("error", error => { void fail(new Error(`cloudflared failed to start: ${error.message}`)); });
                record.child.once("close", (code, signal) => {
                    record.exited = true;
                    if (!settled) { void fail(new Error(`cloudflared exited before creating a Quick Tunnel (code ${code ?? "unknown"}${signal ? `, ${signal}` : ""})`)); return; }
                    if (record.status === "running") {
                        record.status = "failed";
                        record.error = `cloudflared exited unexpectedly (code ${code ?? "unknown"}${signal ? `, ${signal}` : ""})`;
                        record.publicUrl = null;
                    }
                });
                timer = setTimeout(() => { void fail(new Error(`Timed out waiting ${startupTimeoutMs} ms for cloudflared to publish a Quick Tunnel URL`)); }, startupTimeoutMs);
            });
            record.startPromise.catch(() => {});
            return record.startPromise;
        },

        getTunnelStatus(deploymentId) {
            const record = tunnels.get(String(deploymentId));
            if (!record) return null;
            return snapshot(record);
        },

        async stopTunnel(deploymentId) {
            const record = tunnels.get(String(deploymentId));
            if (!record) return null;
            if (record.status === "starting" && record.startPromise) {
                try { await record.startPromise; } catch { return this.getTunnelStatus(deploymentId); }
            }
            return stopRecord(record);
        },

        async stopAllTunnels() {
            await Promise.all([...tunnels.values()].map(record => stopRecord(record)));
            return [...tunnels.keys()].map(id => this.getTunnelStatus(id));
        }
    };
    return manager;
};

const defaultTunnelManager = createTunnelManager();
export const checkCloudflaredInstalled = (...args) => defaultTunnelManager.checkCloudflaredInstalled(...args);
export const startTunnel = (...args) => defaultTunnelManager.startTunnel(...args);
export const getTunnelStatus = (...args) => defaultTunnelManager.getTunnelStatus(...args);
export const stopTunnel = (...args) => defaultTunnelManager.stopTunnel(...args);
export const stopAllTunnels = (...args) => defaultTunnelManager.stopAllTunnels(...args);
