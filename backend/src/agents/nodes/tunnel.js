import { startTunnel as startQuickTunnel, stopTunnel as stopQuickTunnel } from "../../services/cloudflare/tunnelService.js";

export const verifyPublicTunnel = async (publicUrl, { attempts = 8, intervalMs = 1500 } = {}) => {
    if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(publicUrl || "")) {
        return { success: false, message: "Tunnel URL is not a valid Cloudflare Quick Tunnel hostname" };
    }
    let lastStatus = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const response = await fetch(publicUrl, { redirect: "manual", signal: AbortSignal.timeout(5000) });
            lastStatus = response.status;
            if (response.status >= 200 && response.status < 400) {
                return { success: true, statusCode: response.status, attempts: attempt, checkedAt: new Date() };
            }
        } catch {}
        if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    return { success: false, statusCode: lastStatus, attempts, message: "Public tunnel URL did not return a successful HTTP response" };
};

export const tunnel = async (state, config) => {
    const ctx = config?.configurable || {};
    try {
        await ctx.onStage?.("tunnel-start");
        if (!state.deploymentId) throw new Error("Deployment ID is required to start a Cloudflare Quick Tunnel");
        if (!state.healthCheck?.success || !state.hostPort) throw new Error("A verified local application and assigned host port are required before tunnel startup");
        const serviceUrl = `http://127.0.0.1:${state.hostPort}`;
        await ctx.onLog?.(`Starting Cloudflare Quick Tunnel for ${serviceUrl}`);
        const tunnelStatus = await (ctx.startTunnel || startQuickTunnel)(serviceUrl, String(state.deploymentId));
        if (tunnelStatus?.status !== "running" || !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(tunnelStatus.publicUrl || "")) {
            throw new Error("cloudflared did not confirm a valid public Quick Tunnel URL");
        }
        await ctx.onStage?.("public-verification");
        const publicCheck = await (ctx.verifyPublicUrl || verifyPublicTunnel)(tunnelStatus.publicUrl);
        if (!publicCheck?.success) throw new Error(publicCheck?.message || "The public Quick Tunnel URL could not be verified");
        await ctx.onLog?.(`Cloudflare Quick Tunnel ready at ${tunnelStatus.publicUrl}`, "success");
        return { tunnelStatus, publicUrl: tunnelStatus.publicUrl, publicCheck, workflowStage: "public-verification", error: null, logs: [`Quick Tunnel ready and verified at ${tunnelStatus.publicUrl}`] };
    } catch (error) {
        try { await (ctx.stopTunnel || stopQuickTunnel)(String(state.deploymentId)); }
        catch (cleanupError) { await ctx.onLog?.(`Tunnel cleanup failed: ${cleanupError.message}`, "warning"); }
        // A tunnel failure is not an application failure. Keep the locally
        // verified container and image alive so the user can inspect/retry it.
        const failure = { stage: "tunnel", message: error.message, retryable: false };
        await ctx.onLog?.(`${failure.message}. The locally verified container was kept running for diagnosis.`, "error");
        return {
            tunnelStatus: {
                deploymentId: String(state.deploymentId),
                serviceUrl: `http://127.0.0.1:${state.hostPort}`,
                publicUrl: null,
                status: "failed",
                error: error.message
            },
            publicUrl: null,
            error: failure,
            errors: [failure],
            status: "failed",
            workflowStage: "failed",
            logs: [failure.message],
            containerId: state.containerId,
            imageName: state.imageName
        };
    }
};
