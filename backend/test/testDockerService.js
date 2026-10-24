import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    buildDockerImage,
    runDockerContainer
} from "../src/services/docker/dockerService.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

const repoPath = path.resolve(
    currentDir,
    "../temp/docker-demo"
);

try {
    const build = await buildDockerImage(
        repoPath,
        "devops-agent-demo:1.0"
    );

    console.log("Image built:", build.imageName);

    const container = await runDockerContainer(
        "devops-agent-demo:1.0",
        3001,
        3000
    );

    console.log("Container started:", container.containerId);
    console.log("Test URL: http://localhost:3001");
} catch (error) {
    console.error("Docker test failed:", error.message);
}