import { END, START, StateGraph } from "@langchain/langgraph";
import { DeploymentState } from "./graphState.js";
import { repositoryDiscovery } from "../nodes/repositoryDiscovery.js";
import { devopsPlanning } from "../nodes/devopsPlanning.js";
import { containerization } from "../nodes/containerization.js";
import { deployment } from "../nodes/deployment.js";
import { verification } from "../nodes/verification.js";
import { errorRecovery } from "../nodes/errorRecovery.js";
import { releaseRollback } from "../nodes/releaseRollback.js";
import { changeImpact } from "../nodes/changeImpact.js";
import { tunnel } from "../nodes/tunnel.js";

const defaultNodes = { repositoryDiscovery, devopsPlanning, changeImpact, containerization, deployment, verification, tunnel, errorRecovery, releaseRollback };

export const createDeploymentGraph = (nodeOverrides = {}) => {
    const nodes = { ...defaultNodes, ...nodeOverrides };
    const graph = new StateGraph(DeploymentState)
        .addNode("repositoryDiscovery", nodes.repositoryDiscovery)
        .addNode("devopsPlanning", nodes.devopsPlanning)
        .addNode("changeImpact", nodes.changeImpact)
        .addNode("containerization", nodes.containerization)
        .addNode("deployment", nodes.deployment)
        .addNode("verification", nodes.verification)
        .addNode("tunnel", nodes.tunnel)
        .addNode("errorRecovery", nodes.errorRecovery)
        .addNode("releaseRollback", nodes.releaseRollback)
        .addEdge(START, "repositoryDiscovery")
        .addConditionalEdges("repositoryDiscovery", state => state.error ? "errorRecovery" : "devopsPlanning", { errorRecovery: "errorRecovery", devopsPlanning: "devopsPlanning" })
        .addConditionalEdges("devopsPlanning", state => state.error ? "errorRecovery" : "changeImpact", { errorRecovery: "errorRecovery", changeImpact: "changeImpact" })
        .addEdge("changeImpact", "containerization")
        .addConditionalEdges("containerization", state => state.error ? "errorRecovery" : "deployment", { errorRecovery: "errorRecovery", deployment: "deployment" })
        .addConditionalEdges("deployment", state => state.error ? "errorRecovery" : "verification", { errorRecovery: "errorRecovery", verification: "verification" })
        .addConditionalEdges("verification", state => state.error ? "errorRecovery" : "tunnel", { errorRecovery: "errorRecovery", tunnel: "tunnel" })
        .addConditionalEdges("tunnel", state => state.error ? "errorRecovery" : "releaseRollback", { errorRecovery: "errorRecovery", releaseRollback: "releaseRollback" })
        .addConditionalEdges("errorRecovery", state => state.retryTarget || "done", { repositoryDiscovery: "repositoryDiscovery", deployment: "deployment", done: END })
        .addEdge("releaseRollback", END);
    return graph.compile();
};

export const deploymentGraph = createDeploymentGraph();
