
import { deployRepository } from "../src/services/deployment/deploymentPipelineService.js";

const result = await deployRepository(
    "https://github.com/octocat/Hello-World",
    {
        hostPort: 3002,
        containerPort: 3000
    }
);

console.log(JSON.stringify(result, null, 2));
