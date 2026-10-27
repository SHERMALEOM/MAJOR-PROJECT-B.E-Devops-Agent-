export const analyzeChangeImpact = changedFiles => {
    if (!Array.isArray(changedFiles) || changedFiles.length === 0) return { available: false, affectedSteps: ["repository-analysis", "build", "verification"], reason: "No change list was supplied; the full deployment path is required." };
    const files = changedFiles.map(file => String(file).replaceAll("\\", "/").toLowerCase());
    const affectsBuild = files.some(file => /(^|\/)(package(-lock)?\.json|vite\.config\.|requirements\.txt|pyproject\.toml|dockerfile|\.dockerignore)$/.test(file));
    const affectsApp = files.some(file => !file.includes("readme") && !file.startsWith("docs/"));
    return { available: true, affectedSteps: affectsBuild ? ["containerization", "build", "verification"] : affectsApp ? ["build", "verification"] : ["verification"], changedFiles: files };
};

export const changeImpact = async state => {
    const impact = analyzeChangeImpact(state.changedFiles);
    return { impact, plan: { ...state.plan, impact }, logs: [impact.reason || `Change impact affects ${impact.affectedSteps.join(", ")}`], workflowStage: "change-impact" };
};
