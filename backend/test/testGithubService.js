
import { cloneRepository } from "../src/services/github/githubService.js";
import { analyzeRepository } from "../src/services/github/repositoryAnalyzer.js";

try {
    const cloned = await cloneRepository(
        "https://github.com/octocat/Hello-World"
    );

    console.log("Clone successful:", cloned.repositoryName);
    console.log("Local path:", cloned.localPath);

    const analysis = await analyzeRepository(cloned.localPath);

    console.log(
        "Repository analysis:",
        JSON.stringify(analysis, null, 2)
    );
} catch (error) {
    console.error("Test failed:", error.message);
}
