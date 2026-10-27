
import path from "node:path";

import { cloneRepository } from "../github/githubService.js";
import { analyzeRepository } from "../github/repositoryAnalyzer.js";
import { detectBuildStrategy } from "./buildStrategyService.js";
import {
    buildDockerImage,
    runDockerContainer,
    removeDockerContainer
} from "../docker/dockerService.js";
import { deploymentGraph } from "../../agents/graph/deploymentGraph.js";
import { generateDockerfile } from "./dockerfileGenerator.js";

const verifyApplication = async (hostPort, maxAttempts = 10) => {
    const url = `http://127.0.0.1:${hostPort}`;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(3000)
            });

            if (response.ok) {
                return {
                    success: true,
                    statusCode: response.status,
                    url
                };
            }
        } catch {
            // The application may still be starting.
        }

        if (attempt < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    return {
        success: false,
        url,
        message: "Application did not respond successfully"
    };
};

const legacyDeployRepository = async (
    githubUrl,
    { hostPort = 3001, containerPort = 3000, onStage = async () => {}, onLog = async () => {} } = {}
) => {
    let stage = "initialization";
    let startedContainerId = null;

    try {
        // 1. Clone the GitHub repository
        stage = "repository-cloning";
        await onStage(stage);
        await onLog("Cloning the GitHub repository");

        const repository = await cloneRepository(githubUrl);
        const repoPath = repository.localPath;

        // 2. Analyze the repository
        stage = "repository-analysis";
        await onStage(stage);

        const analysis = await analyzeRepository(repoPath);

        if (!analysis || analysis.success === false) {
            throw new Error(
                analysis?.message || "Repository analysis failed"
            );
        }

        // 3. Select a build strategy
        stage = "build-strategy";
        await onStage(stage);

        const strategy = await detectBuildStrategy(repoPath);

        if (!strategy || !strategy.success) {
            throw new Error(
                strategy?.reason || "No supported build strategy found"
            );
        }

        stage = "dockerfile-validation";
        await onStage(stage);
        const dockerfile = await generateDockerfile(repoPath, strategy, containerPort);
        if (dockerfile.generated) await onLog(`Generated Dockerfile for ${strategy.strategy}`);

        // 4. Build the Docker image
        stage = "docker-image-build";
        await onStage(stage);

        const safeName = (repository.repositoryName || "app")
            .toLowerCase()
            .replace(/[^a-z0-9_.-]/g, "-")
            .replace(/^[^a-z0-9]+/, "") || "app";

        const imageName = `${safeName}:${Date.now()}`;

        const image = await buildDockerImage(repoPath, imageName);

        // 5. Start the container
        stage = "container-start";
        await onStage(stage);

        const container = await runDockerContainer(
            imageName,
            hostPort,
            containerPort
        );
        startedContainerId = container.containerId;

        // 6. Verify the application
        stage = "application-verification";
        await onStage(stage);

        const health = await verifyApplication(hostPort);

        if (!health.success) {
            try { await removeDockerContainer(container.containerId); }
            catch (cleanupError) { await onLog(`Container cleanup failed: ${cleanupError.message}`, "warning"); }
            startedContainerId = null;
            return {
                success: false,
                status: "verification_failed",
                failedStage: stage,
                repositoryName: repository.repositoryName,
                imageName,
                containerId: container.containerId,
                localUrl: health.url,
                message: health.message
            };
        }

        // 7. Return deployment information
        return {
            success: true,
            status: "running",
            repositoryName: repository.repositoryName,
            localPath: repoPath,
            detectedLanguages: analysis.languages || [],
            detectedFrameworks: analysis.frameworks || [],
            buildStrategy: strategy.strategy,
            imageName,
            containerId: container.containerId,
            localUrl: health.url,
            healthStatus: "healthy",
            message: "Deployment verified successfully"
        };
    } catch (error) {
        if (startedContainerId) {
            try { await removeDockerContainer(startedContainerId); }
            catch (cleanupError) { await onLog(`Container cleanup failed: ${cleanupError.message}`, "warning"); }
        }
        await onLog(error.message, "error");
        return {
            success: false,
            status: "failed",
            failedStage: stage,
            message: error.message
        };
    }
};

export const deployRepository = async (githubUrl, { hostPort = 3001, containerPort = 3000, onStage = async () => {}, onLog = async () => {}, deploymentId = "", projectId = "", changedFiles = [], graph = deploymentGraph, startTunnel, stopTunnel, verifyPublicUrl } = {}) => {
    const result = await graph.invoke({
        deploymentId: String(deploymentId),
        projectId: String(projectId),
        repositoryUrl: githubUrl,
        repositoryPath: "",
        repositoryName: "",
        projectRoot: "",
        buildContextPath: "",
        dockerfilePath: "",
        localUrl: null,
        healthCheckPath: null,
        analysis: null,
        buildStrategy: null,
        plan: null,
        dockerfile: "",
        imageName: "",
        containerId: "",
        hostPort,
        containerPort,
        healthCheck: null,
        tunnelStatus: null,
        publicUrl: null,
        publicCheck: null,
        workflowStage: "queued",
        logs: [],
        error: null,
        errors: [],
        retryCount: 0,
        retryTarget: null,
        status: "pending",
        impact: null,
        release: null,
        previousRelease: null,
        changedFiles
    }, { configurable: { onStage, onLog, startTunnel, stopTunnel, verifyPublicUrl } });
    return {
        deploymentId: result.deploymentId || String(deploymentId),
        success: result.status === "success",
        status: result.status,
        failedStage: result.error?.stage || null,
        message: result.error?.message || (result.status === "success" ? "Deployment verified successfully" : "Deployment failed"),
        repositoryName: result.repositoryName,
        localPath: result.repositoryPath,
        detectedLanguages: result.analysis?.languages || [],
        detectedFrameworks: result.analysis?.frameworks || [],
        buildStrategy: result.buildStrategy?.strategy,
        imageName: result.imageName,
        containerId: result.containerId,
        hostPort: result.hostPort,
        containerPort: result.containerPort,
        localUrl: result.healthCheck?.url,
        publicUrl: result.publicUrl || null,
        tunnelStatus: result.tunnelStatus || null,
        publicCheck: result.publicCheck || null,
        healthCheck: result.healthCheck,
        retryCount: result.retryCount,
        release: result.release,
        previousRelease: result.previousRelease
    };
};
