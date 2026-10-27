import assert from "node:assert/strict";
import { checkCloudflaredInstalled, startTunnel, stopTunnel } from "../src/services/cloudflare/tunnelService.js";

if (!await checkCloudflaredInstalled()) {
    console.log("SKIP: cloudflared is not installed; install it before running this optional integration test");
    process.exit(0);
}

const server = await import("node:http").then(({ createServer }) => createServer((_req, res) => { res.writeHead(200); res.end("quick tunnel integration ok"); }));
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const deploymentId = `integration-${process.pid}`;
try {
    const tunnel = await startTunnel(`http://127.0.0.1:${port}`, deploymentId);
    const response = await fetch(tunnel.publicUrl, { signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "quick tunnel integration ok");
    console.log(`PASS: Quick Tunnel reached the local HTTP service at ${tunnel.publicUrl}`);
} finally {
    await stopTunnel(deploymentId);
    await new Promise(resolve => server.close(resolve));
}
