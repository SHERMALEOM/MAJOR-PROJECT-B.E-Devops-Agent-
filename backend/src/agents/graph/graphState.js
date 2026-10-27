
import { Annotation } from "@langchain/langgraph";

const withDefault = value =>
    Annotation({
        reducer: (_current, update) => update,
        default: () => value
    });

export const DeploymentState = Annotation.Root({
    deploymentId: Annotation(),
    projectId: Annotation(),
    repositoryUrl: Annotation(),
    repositoryPath: Annotation(),
    repositoryName: Annotation(),
    // Selected application root inside the cloned repository.
    projectRoot: withDefault(""),
    buildContextPath: withDefault(""),
    dockerfilePath: withDefault(""),
    localUrl: withDefault(null),
    healthCheckPath: withDefault(null),
    analysis: Annotation(),
    buildStrategy: Annotation(),
    plan: Annotation(),

    // Gemini's advisory review of the deployment plan
    aiAdvice: withDefault(""),

    dockerfile: Annotation(),
    imageName: Annotation(),
    containerId: Annotation(),
    hostPort: Annotation(),
    containerPort: Annotation(),
    healthCheck: Annotation(),
    tunnelStatus: Annotation(),
    publicUrl: Annotation(),
    publicCheck: Annotation(),

    workflowStage: withDefault("queued"),

    logs: Annotation({
        reducer: (current, update) => current.concat(update),
        default: () => []
    }),

    error: withDefault(null),

    errors: Annotation({
        reducer: (current, update) => current.concat(update),
        default: () => []
    }),

    retryCount: withDefault(0),
    retryTarget: withDefault(null),
    status: withDefault("pending"),
    impact: Annotation(),
    release: Annotation(),
    previousRelease: Annotation(),
    changedFiles: Annotation()
});

export const INITIAL_RECOVERY_LIMIT = 1;
