
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const normalizePath = value => {
    if (!value) return "/";
    return value.startsWith("/") ? value : `/${value}`;
};

export const checkApplicationHealth = async (
    hostPort,
    {
        attempts = 15,
        intervalMs = 2000,
        path: configuredPath = null,
        paths = []
    } = {}
) => {
    const port = Number(hostPort);

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return {
            success: false,
            message: `Invalid application host port: ${hostPort}`,
            url: null
        };
    }

    const candidates = [
        ...new Set(
            [
                configuredPath,
                ...paths,
                "/",
                "/health",
                "/healthz",
                "/api/health"
            ]
                .filter(Boolean)
                .map(normalizePath)
        )
    ];

    let lastError = "No HTTP response received";
    let lastStatusCode = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        for (const candidate of candidates) {
            const url = `http://127.0.0.1:${port}${candidate}`;

            try {
                const response = await fetch(url, {
                    redirect: "follow",
                    signal: AbortSignal.timeout(3000)
                });

                lastStatusCode = response.status;

                if (response.ok) {
                    return {
                        success: true,
                        url,
                        path: candidate,
                        statusCode: response.status,
                        checkedAt: new Date(),
                        attemptsUsed: attempt
                    };
                }

                lastError = `HTTP ${response.status} ${response.statusText} at ${url}`;
            } catch (error) {
                lastError = `${url}: ${error.message}`;
            }
        }

        if (attempt < attempts) {
            await sleep(intervalMs);
        }
    }

    return {
        success: false,
        url: `http://127.0.0.1:${port}`,
        message:
            `Application did not pass HTTP verification after ${attempts} attempts. ` +
            `Last error: ${lastError}`,
        lastStatusCode,
        checkedAt: new Date()
    };
};

export const verification = async (state, config) => {
    const ctx = config?.configurable || {};
    const hostPort = Number(state.hostPort);

    try {
        if (!Number.isInteger(hostPort) || hostPort < 1 || hostPort > 65535) {
            throw new Error(
                `Cannot verify application: invalid host port "${state.hostPort}".`
            );
        }

        await ctx.onStage?.("verification");
        await ctx.onLog?.(
            `Checking application on host port ${hostPort}`
        );

        const configuredPath =
            state.healthCheckPath ||
            state.buildStrategy?.healthCheckPath ||
            null;

        const healthCheck = await checkApplicationHealth(hostPort, {
            attempts: 15,
            intervalMs: 2000,
            path: configuredPath
        });

        if (!healthCheck.success) {
            await ctx.onLog?.(healthCheck.message, "error");

            return {
                healthCheck,
                error: {
                    stage: "verification",
                    message: healthCheck.message,
                    retryable: true
                },
                errors: [
                    {
                        stage: "verification",
                        message: healthCheck.message,
                        retryable: true
                    }
                ],
                status: "failed",
                workflowStage: "failed"
            };
        }

        const message =
            `Health check passed: HTTP ${healthCheck.statusCode} at ${healthCheck.url}`;

        await ctx.onLog?.(message, "success");

        return {
            healthCheck,
            error: null,
            errors: [],
            status: "success",
            workflowStage: "verification"
        };
    } catch (error) {
        const failure = {
            stage: "verification",
            message: error.message,
            retryable: true
        };

        await ctx.onLog?.(failure.message, "error");

        return {
            error: failure,
            errors: [failure],
            status: "failed",
            workflowStage: "failed"
        };
    }
};
