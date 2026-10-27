
import fs from "node:fs";
import path from "node:path";

import { generateDockerfile } from "../../services/deployment/dockerfileGenerator.js";

const isValidPort = value => {
    const port = Number(value);

    return Number.isInteger(port) && port >= 1 && port <= 65535;
};

const readExposedPort = dockerfilePath => {
    try {
        const content = fs.readFileSync(dockerfilePath, "utf8");

        // Use the last EXPOSE declaration because multi-stage Dockerfiles
        // may contain more than one.
        const matches = [
            ...content.matchAll(/^\s*EXPOSE\s+(.+)$/gim)
        ];

        for (let i = matches.length - 1; i >= 0; i--) {
            const ports = matches[i][1]
                .trim()
                .split(/\s+/)
                .map(value => value.split("/")[0]);

            for (const value of ports) {
                if (isValidPort(value)) {
                    return Number(value);
                }
            }
        }
    } catch {
        // Port detection can continue using the build strategy.
    }

    return null;
};

export const containerization = async (state, config) => {
    const ctx = config?.configurable || {};

    try {
        await ctx.onStage?.("containerization");
        await ctx.onLog?.("Preparing the Dockerfile and container configuration");

        if (!state.repositoryPath || !path.isAbsolute(state.repositoryPath)) {
            throw new Error("A valid absolute repository path is required.");
        }

        if (!state.buildStrategy) {
            throw new Error(
                "Build strategy is missing. Repository analysis must complete first."
            );
        }

        const result = await generateDockerfile(
            state.repositoryPath,
            state.buildStrategy
        );

        if (!result?.success) {
            throw new Error(
                result?.error || "Dockerfile generation failed."
            );
        }

        const dockerfilePath =
            result.dockerfilePath ||
            path.join(result.projectRoot || state.repositoryPath, "Dockerfile");

        if (!fs.existsSync(dockerfilePath)) {
            throw new Error(
                `Dockerfile was not found at ${dockerfilePath}`
            );
        }

        // Prefer the port returned by the Dockerfile generator.
        // If it is absent, inspect the Dockerfile and then the strategy.
        const detectedPort =
            (isValidPort(result.port) ? Number(result.port) : null) ||
            readExposedPort(dockerfilePath) ||
            (isValidPort(state.buildStrategy.port)
                ? Number(state.buildStrategy.port)
                : null);

        if (!detectedPort) {
            throw new Error(
                "Could not determine the container port. " +
                "Add a valid EXPOSE instruction to the Dockerfile or configure " +
                "the application port in the build strategy."
            );
        }

        const updatedStrategy = {
            ...state.buildStrategy,
            projectRoot: result.projectRoot || state.buildStrategy.projectRoot,
            port: detectedPort,
            dockerfilePath
        };

        await ctx.onLog?.(
            `Dockerfile ready: ${dockerfilePath}`
        );

        await ctx.onLog?.(
            `Container port detected: ${detectedPort}`
        );

        return {
            // dockerService builds from this directory, so keep the Dockerfile
            // and build context rooted at the same selected application directory.
            dockerfile: dockerfilePath,
            dockerfilePath,
            buildContextPath: result.projectRoot || state.repositoryPath,
            buildStrategy: updatedStrategy,
            containerPort: detectedPort,
            projectRoot: result.projectRoot || state.repositoryPath,
            workflowStage: "containerization",
            status: "running",
            error: null,
            errors: []
        };
    } catch (error) {
        const failure = {
            stage: "containerization",
            message: error.message,
            retryable: false
        };

        await ctx.onLog?.(failure.message, "error");

        return {
            error: failure,
            errors: [failure],
            workflowStage: "failed",
            status: "failed"
        };
    }
};
