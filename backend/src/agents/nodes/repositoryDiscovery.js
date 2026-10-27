import { cloneRepository } from "../../services/github/githubService.js";
import { analyzeRepository } from "../../services/github/repositoryAnalyzer.js";

export const repositoryDiscovery = async (state, config) => {
    const ctx = config?.configurable || {};
    try {
        await ctx.onStage?.("repository-cloning");
        await ctx.onLog?.("Validating and cloning the GitHub repository");
        const repository = await cloneRepository(state.repositoryUrl);
        await ctx.onStage?.("repository-analysis");
        const analysis = await analyzeRepository(repository.localPath);
        if (!analysis?.success || !analysis.detected) throw new Error(analysis?.message || "No supported application language was detected");
        await ctx.onLog?.(`Detected ${analysis.languages.join(", ") || "application"}${analysis.frameworks?.length ? ` (${analysis.frameworks.join(", ")})` : ""}`);
        return { repositoryPath: repository.localPath, repositoryName: repository.repositoryName, analysis, logs: [`Cloned ${repository.repositoryName}`, `Detected ${analysis.languages.join(", ")}`], workflowStage: "repository-discovery", error: null };
    } catch (error) {
        const failure = { stage: "repository-discovery", message: error.message, retryable: true };
        await ctx.onLog?.(failure.message, "error");
        return { error: failure, errors: [failure], logs: [failure.message], workflowStage: "failed", status: "failed" };
    }
};
