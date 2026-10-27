
import { INITIAL_RECOVERY_LIMIT } from "../graph/graphState.js";
import { explainDeploymentError } from "../../services/ai/geminiService.js";

export const errorRecovery = async (state, config) => {
    const ctx = config?.configurable || {};
    const stage = state.error?.stage;
    const message = state.error?.message || "Unknown deployment error";

    let aiExplanation = "";

    // AI is advisory only. A Gemini failure must not block recovery.
    try {
        aiExplanation = await explainDeploymentError({
            stage,
            message,
            repositoryName: state.repositoryName,
            buildStrategy: state.buildStrategy
        });

        await ctx.onLog?.(
            `Gemini diagnosis: ${aiExplanation}`,
            "info"
        );
    } catch (error) {
        await ctx.onLog?.(
            `Gemini diagnosis unavailable: ${error.message}`,
            "warning"
        );
    }

    // Don't repeat the same build when application verification fails.
    if (stage === "verification") {
        return {
            retryTarget: "done",
            workflowStage: "error-recovery",
            status: "failed",
            logs: [
                "Verification failed. Automatic rebuild skipped.",
                ...(aiExplanation
                    ? [`AI diagnosis: ${aiExplanation}`]
                    : [])
            ]
        };
    }

    const retryableStages = [
        "repository-discovery",
        "deployment"
    ];

    const retryable = retryableStages.includes(stage);

    if (retryable && state.retryCount < INITIAL_RECOVERY_LIMIT) {
        const retryTarget =
            stage === "repository-discovery"
                ? "repositoryDiscovery"
                : "deployment";

        return {
            retryCount: state.retryCount + 1,
            retryTarget,
            error: null,
            workflowStage: "error-recovery",
            status: "pending",
            logs: [
                `Retrying ${stage} once after: ${message}`,
                ...(aiExplanation
                    ? [`AI diagnosis: ${aiExplanation}`]
                    : [])
            ]
        };
    }

    return {
        retryTarget: "done",
        workflowStage: "error-recovery",
        status: "failed",
        logs: [
            `Recovery stopped after ${state.retryCount} retries: ${message}`,
            ...(aiExplanation
                ? [`AI diagnosis: ${aiExplanation}`]
                : [])
        ]
    };
};
