import fs from "node:fs";
import path from "node:path";

import { detectBuildStrategy } from "./buildStrategyService.js";
import { generateDockerfile } from "./dockerfileGenerator.js";

const fail = (error) => ({
    success: false,
    error
});

export const detectProjectStrategy = async (repositoryPath) => {
    try {
        if (
            !repositoryPath ||
            !path.isAbsolute(repositoryPath) ||
            !fs.existsSync(repositoryPath) ||
            !fs.statSync(repositoryPath).isDirectory()
        ) {
            return fail("Repository path must be an existing absolute directory.");
        }

        const strategy = await detectBuildStrategy(repositoryPath);

        if (!strategy?.supported || !strategy.strategy) {
            return fail(
                strategy?.error ||
                strategy?.reason ||
                "No supported deployment strategy was detected."
            );
        }

        const projectRoot = path.resolve(
            strategy.projectRoot || repositoryPath
        );

        const relativeRoot = path.relative(
            path.resolve(repositoryPath),
            projectRoot
        );

        if (
            relativeRoot.startsWith("..") ||
            path.isAbsolute(relativeRoot)
        ) {
            return fail("Detected project root is outside the cloned repository.");
        }

        return {
            success: true,
            strategy: {
                ...strategy,
                projectRoot
            }
        };
    } catch (error) {
        return fail(`Project detection failed: ${error.message}`);
    }
};

export const prepareProjectForDeployment = async (
    repositoryPath,
    strategy
) => {
    try {
        if (!strategy?.supported || !strategy.strategy) {
            return fail("A supported build strategy is required.");
        }

        const detected = await detectProjectStrategy(repositoryPath);

        if (!detected.success) {
            return detected;
        }

        // Use the strategy detected by planning, but reject stale or
        // mismatched project-root paths.
        const plannedRoot = path.resolve(
            strategy.projectRoot || repositoryPath
        );

        if (plannedRoot !== detected.strategy.projectRoot) {
            return fail(
                "The project root changed between planning and containerization. Re-run project detection."
            );
        }

        const result = generateDockerfile(
            repositoryPath,
            {
                ...detected.strategy,
                ...strategy,
                projectRoot: detected.strategy.projectRoot
            }
        );

        if (!result?.success) {
            return fail(result?.error || "Dockerfile generation failed.");
        }

        const projectRoot = path.resolve(
            result.projectRoot || detected.strategy.projectRoot
        );

        const dockerfilePath = path.resolve(
            result.dockerfilePath || path.join(projectRoot, "Dockerfile")
        );

        if (
            !dockerfilePath.startsWith(projectRoot + path.sep) ||
            !fs.existsSync(dockerfilePath) ||
            !fs.statSync(dockerfilePath).isFile()
        ) {
            return fail("Generated Dockerfile path is invalid.");
        }

        const port = Number(
            result.port || strategy.port || detected.strategy.port
        );

        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            return fail("The deployment strategy has no valid container port.");
        }

        return {
            success: true,
            generated: result.generated === true,
            existing: result.existing === true,
            strategy: detected.strategy,
            projectRoot,
            buildContextPath: projectRoot,
            dockerfilePath,
            dockerfile: fs.readFileSync(dockerfilePath, "utf8"),
            containerPort: port
        };
    } catch (error) {
        return fail(`Deployment preparation failed: ${error.message}`);
    }
};
