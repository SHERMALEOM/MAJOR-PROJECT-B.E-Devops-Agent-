import assert from "node:assert/strict";
import { createDeploymentGraph } from "../src/agents/graph/deploymentGraph.js";
import { errorRecovery } from "../src/agents/nodes/errorRecovery.js";

const baseNodes = () => ({
    repositoryDiscovery: async () => ({ repositoryPath: "/tmp/repository", repositoryName: "demo", analysis: { success: true, detected: true, languages: ["JavaScript"], frameworks: [] }, error: null }),
    devopsPlanning: async () => ({ buildStrategy: { success: true, strategy: "nodejs" }, plan: { strategy: "nodejs" }, error: null }),
    changeImpact: async state => ({ impact: { available: false, affectedSteps: ["build", "verification"] }, plan: state.plan }),
    containerization: async () => ({ dockerfile: "FROM node:20-alpine", error: null }),
    deployment: async () => ({ imageName: "demo:test", containerId: "a".repeat(64), error: null }),
    verification: async () => ({ healthCheck: { success: true, url: "http://127.0.0.1:3001" }, status: "success", error: null }),
    tunnel: async state => ({ tunnelStatus: { deploymentId: state.deploymentId, status: "running", publicUrl: "https://example.trycloudflare.com" }, publicUrl: "https://example.trycloudflare.com", error: null }),
    errorRecovery,
    releaseRollback: async state => ({ status: "success", workflowStage: "release-tracking", release: { imageName: state.imageName }, previousRelease: null })
});

const initial = { deploymentId: "dep-1", projectId: "project-1", repositoryUrl: "https://github.com/example/demo", hostPort: 3001, containerPort: 3000 };

const successGraph = createDeploymentGraph(baseNodes());
const success = await successGraph.invoke(initial);
assert.equal(success.status, "success");
assert.equal(success.workflowStage, "release-tracking");
assert.equal(success.release.imageName, "demo:test");

let discoveryCalls = 0;
const discoveryNodes = baseNodes();
discoveryNodes.repositoryDiscovery = async () => {
    discoveryCalls++;
    return discoveryCalls === 1
        ? { error: { stage: "repository-discovery", message: "temporary clone error", retryable: true }, status: "failed" }
        : { repositoryPath: "/tmp/repository", repositoryName: "demo", analysis: { success: true, detected: true, languages: ["JavaScript"], frameworks: [] }, error: null };
};
const recoveryResult = await createDeploymentGraph(discoveryNodes).invoke(initial);
assert.equal(discoveryCalls, 2);
assert.equal(recoveryResult.status, "success");
assert.equal(recoveryResult.retryCount, 1);

const exhaustedNodes = baseNodes();
exhaustedNodes.deployment = async () => ({ error: { stage: "deployment", message: "Docker unavailable", retryable: true }, status: "failed" });
const exhausted = await createDeploymentGraph(exhaustedNodes).invoke(initial);
assert.equal(exhausted.status, "failed");
assert.equal(exhausted.retryCount, 1);
assert.equal(exhausted.error.message, "Docker unavailable");

const terminalNodes = baseNodes();
terminalNodes.devopsPlanning = async () => ({ error: { stage: "devops-planning", message: "unsupported project", retryable: false }, status: "failed" });
const terminal = await createDeploymentGraph(terminalNodes).invoke(initial);
assert.equal(terminal.status, "failed");
assert.equal(terminal.retryCount, 0);

console.log("PASS: LangGraph success, conditional routing, discovery retry, unsupported-project failure, and bounded retry exhaustion");
