
import fs from "node:fs";
import path from "node:path";

import {
    detectProjectStrategy
} from "../../services/deployment/universalDeploymentEngine.js";

import {
    askGemini
} from "../../services/ai/geminiService.js";

export const devopsPlanning = async (state, config) => {
    const ctx = config?.configurable || {};

    try {
        await ctx.onStage?.("build-strategy");

        // 1. Validate the cloned repository.
        const repositoryPath = state?.repositoryPath;

        if (
            !repositoryPath ||
            !path.isAbsolute(repositoryPath) ||
            !fs.existsSync(repositoryPath) ||
            !fs.statSync(repositoryPath).isDirectory()
        ) {
            throw new Error(
                `Repository directory does not exist: ${
                    repositoryPath || "No path provided"
                }`
            );
        }

        await ctx.onLog?.(
            `Analyzing repository: ${state?.repositoryName || path.basename(repositoryPath)}`,
            "info"
        );

        console.log("========== DEPLOYMENT DIAGNOSTICS ==========");
        console.log("Repository path:", repositoryPath);
        console.log("Repository name:", state?.repositoryName || "Unknown");

        console.log(
            "Repository root entries:",
            fs.readdirSync(repositoryPath, { withFileTypes: true })
                .map(entry =>
                    `${entry.isDirectory() ? "[DIR]" : "[FILE]"} ${entry.name}`
                )
        );

        console.log(
            "Repository analysis:",
            JSON.stringify(state?.analysis || {}, null, 2)
        );

        // 2. Detect the deployment strategy using the universal engine.
        const detection = await detectProjectStrategy(repositoryPath);

        console.log(
            "Universal engine result:",
            JSON.stringify(detection, null, 2)
        );

        if (!detection?.success || !detection.strategy?.strategy) {
            throw new Error(
                detection?.error ||
                "Universal engine could not detect a supported deployment strategy."
            );
        }

        const buildStrategy = detection.strategy;

        const projectRoot = path.resolve(
            buildStrategy.projectRoot || repositoryPath
        );

        // Ensure the detected root remains inside the cloned repository.
        const relativeRoot = path.relative(
            path.resolve(repositoryPath),
            projectRoot
        );

        if (
            relativeRoot.startsWith("..") ||
            path.isAbsolute(relativeRoot)
        ) {
            throw new Error(
                "Detected project root is outside the cloned repository."
            );
        }

        // 3. Create the deployment plan.
        const containerPort =
            buildStrategy.port ??
            state?.containerPort ??
            null;

        const plan = {
            strategy: buildStrategy.strategy,
            build: buildStrategy.buildCommand ?? null,
            startup: buildStrategy.startCommand ?? null,
            containerPort,
            projectRoot,
            buildContextPath: projectRoot,
            needsBuild: buildStrategy.needsBuild ?? false,
            requiresPortDetection:
                buildStrategy.requiresPortDetection ?? false,
            outputDirectory: buildStrategy.outputDirectory ?? null,
            existingDockerfile: Boolean(buildStrategy.hasDockerfile)
        };

        const selectionMessage =
            `Selected ${buildStrategy.strategy} deployment strategy`;

        await ctx.onLog?.(selectionMessage, "info");
        await ctx.onLog?.(`Project root: ${projectRoot}`, "info");

        if (containerPort == null) {
            await ctx.onLog?.(
                "The container port has not been determined; deployment preparation must resolve it.",
                "warning"
            );
        }

        if (buildStrategy.needsEntryPointDetection) {
            await ctx.onLog?.(
                "The project may require entry-point or startup-command configuration.",
                "warning"
            );
        }

        // 4. Ask Gemini to review the plan.
        // Gemini cannot override the deterministic strategy.
        let aiAdvice = "";

        try {
            aiAdvice = await askGemini(`
Review this deployment plan for an AI DevOps Agent.

Repository name:
${state?.repositoryName || path.basename(repositoryPath)}

Repository analysis:
${JSON.stringify(state?.analysis || {})}

Detected strategy:
${JSON.stringify(buildStrategy)}

Deployment plan:
${JSON.stringify(plan)}

Review:
1. Whether the detected strategy matches the available project information.
2. Whether the build and startup commands appear plausible.
3. Whether the application port is known.
4. Whether databases, environment variables, or multiple services may be required.
5. What still needs verification.

Rules:
- Do not invent repository details.
- Do not request or expose secret values.
- Do not execute commands.
- Do not change the selected strategy.
- Clearly distinguish confirmed facts from assumptions.

Return concise findings and recommended checks.
`);

            if (aiAdvice) {
                await ctx.onLog?.(
                    `Gemini deployment review: ${aiAdvice}`,
                    "info"
                );
            }
        } catch (aiError) {
            await ctx.onLog?.(
                `Gemini review unavailable; continuing with deterministic planning: ${
                    aiError?.message || "Unknown AI error"
                }`,
                "warning"
            );
        }

        // 5. Return fields for subsequent LangGraph nodes.
        return {
            buildStrategy,
            plan,
            projectRoot,
            buildContextPath: projectRoot,
            containerPort,
            aiAdvice,
            logs: [
                selectionMessage,
                `Project root: ${projectRoot}`,
                ...(aiAdvice
                    ? [`Gemini deployment review: ${aiAdvice}`]
                    : [])
            ],
            workflowStage: "devops-planning",
            error: null
        };

    } catch (error) {
        const message =
            error?.message || "Deployment planning failed.";

        const failure = {
            stage: "devops-planning",
            message,
            retryable: false
        };

        console.error("[DevOps Planning Error]", message);
        await ctx.onLog?.(message, "error");

        return {
            error: failure,
            errors: [failure],
            logs: [message],
            workflowStage: "failed",
            status: "failed"
        };
    }
};
