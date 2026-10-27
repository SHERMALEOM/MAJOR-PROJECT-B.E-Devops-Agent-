import assert from "node:assert/strict";
import { createDeploymentGraph } from "../src/agents/graph/deploymentGraph.js";
import { deployRepository } from "../src/services/deployment/deploymentPipelineService.js";
import { tunnel } from "../src/agents/nodes/tunnel.js";

let tunnelTarget;
const graph = createDeploymentGraph({
    repositoryDiscovery: async () => ({ repositoryPath: "C:/repo", repositoryName: "demo", analysis: { success: true, languages: ["JavaScript"], frameworks: [] }, error: null }),
    devopsPlanning: async () => ({ buildStrategy: { success: true, strategy: "nodejs" }, error: null }),
    changeImpact: async () => ({ impact: { available: false } }),
    containerization: async () => ({ dockerfile: "Dockerfile", error: null }),
    deployment: async () => ({ imageName: "demo:test", containerId: "a".repeat(64), hostPort: 32123, containerPort: 3000, error: null }),
    verification: async () => ({ healthCheck: { success: true, url: "http://127.0.0.1:32123", statusCode: 200 }, error: null }),
    tunnel,
    releaseRollback: async state => ({ status: "success", release: { imageName: state.imageName, publicUrl: state.publicUrl }, previousRelease: null })
});

const result = await deployRepository("https://github.com/example/demo", {
    deploymentId: "deployment-123", projectId: "project-123", hostPort: 3001, containerPort: 3000, graph,
    startTunnel: async (url, id) => { tunnelTarget = { url, id }; return { deploymentId: id, serviceUrl: url, publicUrl: "https://violet-bird.trycloudflare.com", status: "running" }; },
    verifyPublicUrl: async url => ({ success: url === "https://violet-bird.trycloudflare.com", statusCode: 200 })
});
assert.equal(tunnelTarget.url, "http://127.0.0.1:32123");
assert.equal(tunnelTarget.id, "deployment-123");
assert.equal(result.success, true);
assert.equal(result.publicUrl, "https://violet-bird.trycloudflare.com");
assert.equal(result.publicCheck.statusCode, 200);
assert.equal(result.deploymentId, "deployment-123");

const cleanup = [];
const failedState = await tunnel({ deploymentId: "bad-deploy", hostPort: 32124, healthCheck: { success: true }, containerId: "b".repeat(64), imageName: "demo:bad" }, { configurable: {
    startTunnel: async () => { throw new Error("cloudflared missing"); }, stopTunnel: async id => cleanup.push(`tunnel:${id}`),
    verifyPublicUrl: async () => ({ success: true }),
    removeContainer: async id => cleanup.push(`container:${id}`), removeImage: async name => cleanup.push(`image:${name}`)
} });
assert.equal(failedState.error.stage, "tunnel");
assert.equal(failedState.status, "failed");
assert.deepEqual(cleanup, [`tunnel:bad-deploy`, `container:${"b".repeat(64)}`, "image:demo:bad"]);

const verificationCleanup = [];
const unverifiable = await tunnel({ deploymentId: "unverified", hostPort: 32125, healthCheck: { success: true }, containerId: "c".repeat(64), imageName: "demo:unverified" }, { configurable: {
    startTunnel: async () => ({ status: "running", publicUrl: "https://unverified.trycloudflare.com" }),
    verifyPublicUrl: async () => ({ success: false, message: "public service unreachable" }),
    stopTunnel: async id => verificationCleanup.push(`tunnel:${id}`), removeContainer: async id => verificationCleanup.push(`container:${id}`),
    removeImage: async image => verificationCleanup.push(`image:${image}`)
} });
assert.equal(unverifiable.status, "failed");
assert.equal(unverifiable.error.message, "public service unreachable");
assert.deepEqual(verificationCleanup, [`tunnel:unverified`, `container:${"c".repeat(64)}`, "image:demo:unverified"]);

console.log("PASS: deployment graph starts a tunnel after health verification, returns the real URL, and cleans up failed tunnel deployments");
