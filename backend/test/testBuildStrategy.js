
import { detectBuildStrategy } from "../src/services/deployment/buildStrategyService.js";

const repoPath = "./temp/repositories/react-app";

try {
    const result = await detectBuildStrategy(repoPath);
    console.log(JSON.stringify(result, null, 2));
} catch (error) {
    console.error("Build strategy detection failed:", error.message);
}
