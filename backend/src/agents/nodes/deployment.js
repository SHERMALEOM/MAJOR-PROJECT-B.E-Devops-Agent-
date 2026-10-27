
import crypto from "node:crypto";

import {
    buildDockerImage,
    runDockerContainer,
    removeDockerContainer,
    removeDockerImage
} from "../../services/docker/dockerService.js";

export const deployment = async (state, config) => {
    const ctx = config?.configurable || {};

    let containerId = null;
    let imageName = null;
    let imageBuilt = false;
    let deploymentSucceeded = false;

    const logs = [];

    const log = async (message, level = "info") => {
        logs.push(message);
        console.log(`[Deployment:${level}] ${message}`);

        try {
            await ctx.onLog?.(message, level);
        } catch (callbackError) {
            console.warn(
                "[Deployment] Log callback failed:",
                callbackError?.message
            );
        }
    };

    try {
        // 1. Validate inputs
        await ctx.onStage?.("deployment-validation");

        const repositoryPath = state?.repositoryPath;

        if (!repositoryPath) {
            throw new Error("Repository path is missing.");
        }

        if (!state?.buildStrategy?.strategy) {
            throw new Error("A detected build strategy is required.");
        }

        const buildContextPath =
            state.buildContextPath ||
            state.projectRoot ||
            state.buildStrategy.projectRoot ||
            repositoryPath;

        const containerPort = Number(
            state.containerPort ??
            state.buildStrategy.port
        );

        const hostPort = Number(state.hostPort);

        if (
            !Number.isInteger(containerPort) ||
            containerPort < 1 ||
            containerPort > 65535
        ) {
            throw new Error("A valid container port is required.");
        }

        if (
            !Number.isInteger(hostPort) ||
            hostPort < 1 ||
            hostPort > 65535
        ) {
            throw new Error("A valid host port is required.");
        }

        await log(`Repository: ${state.repositoryName || "app"}`);
        await log(`Strategy: ${state.buildStrategy.strategy}`);
        await log(`Docker build context: ${buildContextPath}`);
        await log(`Container port: ${containerPort}`);
        await log(`Requested host port: ${hostPort}`);

        // 2. Generate a unique Docker image name
        const safeName = (state.repositoryName || "app")
            .toLowerCase()
            .replace(/[^a-z0-9_.-]/g, "-")
            .replace(/^[^a-z0-9]+/, "")
            .slice(0, 100) || "app";

        imageName = `${safeName}:deploy-${crypto
            .randomUUID()
            .replaceAll("-", "")
            .slice(0, 16)}`;

        // 3. Build the Docker image from the selected project root
        await ctx.onStage?.("docker-image-build");
        await log(`Building Docker image: ${imageName}`);

        let pendingOutput = "";
        let outputLineCount = 0;
        let logQueue = Promise.resolve();

        const onOutput = (chunk) => {
            pendingOutput += String(chunk);

            const lines = pendingOutput.split(/\r?\n/);
            pendingOutput = lines.pop() || "";

            for (const line of lines) {
                const trimmed = line.trim();

                if (!trimmed) continue;

                outputLineCount += 1;

                // Avoid overwhelming the UI with build output.
                if (outputLineCount <= 150) {
                    logQueue = logQueue.then(() => log(trimmed));
                }
            }
        };

        const build = await buildDockerImage(
            buildContextPath,
            imageName,
            { onOutput }
        );

        if (pendingOutput.trim() && outputLineCount < 150) {
            const finalLine = pendingOutput.trim();
            logQueue = logQueue.then(() => log(finalLine));
        }

        await logQueue;

        // Supports services that return a success object or throw on failure.
        if (build?.success === false) {
            throw new Error(
                build.error || "Docker image build failed."
            );
        }

        imageBuilt = true;

        await log(`Docker image built successfully: ${imageName}`);

        // 4. Start the container
        await ctx.onStage?.("container-start");

        await log("Starting the Docker container.");

        const container = await runDockerContainer(
            imageName,
            hostPort,
            containerPort
        );

        if (!container?.containerId) {
            throw new Error(
                "Docker did not return a container ID."
            );
        }

        containerId = container.containerId;

        const actualHostPort = Number(
            container.hostPort ?? hostPort
        );

        if (
            !Number.isInteger(actualHostPort) ||
            actualHostPort < 1 ||
            actualHostPort > 65535
        ) {
            throw new Error(
                "Docker returned an invalid host port."
            );
        }

        const localUrl = `http://localhost:${actualHostPort}`;

        await log(`Container started: ${containerId}`);
        await log(`Local application URL: ${localUrl}`);

        deploymentSucceeded = true;

        // 5. Return updated state for verification and tunnel nodes
        return {
            imageName,
            containerId,
            hostPort: actualHostPort,
            containerPort,
            projectRoot: state.projectRoot || buildContextPath,
            buildContextPath,
            dockerfilePath:
                state.dockerfilePath ||
                state.buildStrategy.dockerfilePath ||
                null,
            localUrl,
            logs,
            workflowStage: "deployment",
            error: null
        };
    } catch (error) {
        const message =
            error?.message || "Docker deployment failed.";

        await log(message, "error");

        // 6. Clean up resources created by this attempt
        if (containerId) {
            try {
                await removeDockerContainer(containerId);
                await log("Removed the container from the failed deployment.");
            } catch (cleanupError) {
                await log(
                    `Container cleanup failed: ${cleanupError?.message || "Unknown error"}`,
                    "warning"
                );
            }
        }

        if (imageBuilt && imageName) {
            try {
                await removeDockerImage(imageName);
                await log("Removed the image from the failed deployment.");
            } catch (cleanupError) {
                await log(
                    `Image cleanup failed: ${cleanupError?.message || "Unknown error"}`,
                    "warning"
                );
            }
        }

        const failure = {
            stage: "deployment",
            message,
            retryable: true
        };

        return {
            imageName: null,
            containerId: null,
            logs,
            error: failure,
            errors: [failure],
            workflowStage: "failed",
            status: "failed"
        };
    } finally {
        if (deploymentSucceeded) {
            console.log("[Deployment] Deployment node completed.");
        }
    }
};
