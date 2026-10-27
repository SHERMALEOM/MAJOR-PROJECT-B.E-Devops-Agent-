import assert from "node:assert/strict";
import { checkApplicationHealth } from "../src/agents/nodes/verification.js";

const originalFetch = globalThis.fetch;
try {
    globalThis.fetch = async () => new Response("ok", { status: 200 });
    const healthy = await checkApplicationHealth(3210, { attempts: 1 });
    assert.equal(healthy.success, true);
    assert.equal(healthy.url, "http://127.0.0.1:3210/");
    globalThis.fetch = async () => new Response("unavailable", { status: 503 });
    const unhealthy = await checkApplicationHealth(3210, { attempts: 1 });
    assert.equal(unhealthy.success, false);
    console.log("PASS: health verification uses actual HTTP responses and reports unhealthy responses");
} finally { globalThis.fetch = originalFetch; }
