
import mongoose from "mongoose";
import Deployment from "../models/deploymentmodel.js";
import Project from "../models/projectmodel.js";
import DeploymentLog from "../models/deploymentlogmodel.js";
import { deployRepository } from "../services/deployment/deploymentPipelineService.js";
import { emitDeploymentEvent } from "../sockets/deploymentSocket.js";
import { removeDockerContainer } from "../services/docker/dockerService.js";
import { checkApplicationHealth } from "../agents/nodes/verification.js";
import { stopTunnel } from "../services/cloudflare/tunnelService.js";

// Helper: validate MongoDB ObjectId
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// Helper: find a project owned by the logged-in user
const findOwnedProject = async (projectId, userId) => {
    if (!isValidId(projectId)) {
        return null;
    }

    return Project.findOne({
        _id: projectId,
        userId
    });
};

const runDeployment = async (deployment, project, hostPort, containerPort) => {
    const log = async (message, level = "info") => { const entry = await DeploymentLog.create({ deploymentId: deployment._id, agent: "deployment", level, message }); emitDeploymentEvent(deployment._id, "deployment:log", entry); };
    const update = async (fields) => { Object.assign(deployment, fields); await deployment.save(); emitDeploymentEvent(deployment._id, "deployment:status", deployment); };
    try {
        await update({ status: "cloning", stage: "repository-validation" });
        await log("Deployment queued; validating repository");
        const result = await deployRepository(project.githubUrl, { deploymentId: String(deployment._id), projectId: String(project._id), hostPort, containerPort, onStage: async stage => {
            const statuses = { "repository-cloning": "cloning", "repository-analysis": "analyzing", "build-strategy": "analyzing", "dockerfile-validation": "building", "docker-image-build": "building", "container-start": "deploying", "application-verification": "verifying", "verification": "verifying", "tunnel-start": "deploying", "public-verification": "verifying" };
            await update({ stage, status: statuses[stage] || deployment.status }); await log(`Stage: ${stage}`);
        }, onLog: log });
        // Persist partial deployment details even when public tunnel verification fails.
        // A locally healthy container should remain inspectable, not become orphaned.
        const deploymentDetails = {
            dockerImage: result.imageName || deployment.dockerImage,
            containerId: result.containerId || deployment.containerId,
            containerPort: result.containerPort || deployment.containerPort || containerPort,
            hostPort: result.hostPort || deployment.hostPort || hostPort,
            localUrl: result.localUrl || deployment.localUrl,
            publicUrl: result.publicUrl || null,
            publicCheck: result.publicCheck || null,
            healthCheck: result.healthCheck || deployment.healthCheck,
            previousDeploymentId: result.previousRelease?.deploymentId || deployment.previousDeploymentId || null,
            detectedLanguages: result.detectedLanguages || [],
            detectedFrameworks: result.detectedFrameworks || [],
            buildStrategy: result.buildStrategy || deployment.buildStrategy,
            retryCount: result.retryCount || 0
        };
        if (!result.success) {
            await update(deploymentDetails);
            const failure = new Error(result.message || "Deployment failed");
            failure.stage = result.failedStage;
            throw failure;
        }
        await update({ ...deploymentDetails, status: "success", stage: "healthy", completedAt: new Date() });
        await log(`Health verification passed at ${result.localUrl}`, "success");
        await log(`Public Quick Tunnel URL: ${result.publicUrl}`, "success");
        emitDeploymentEvent(deployment._id, "deployment:success", deployment);
        await Project.updateOne({ _id: project._id }, { status: "deployed", language: result.detectedLanguages?.[0] || null, framework: result.detectedFrameworks?.[0] || null, detectedPort: containerPort });
    } catch (error) {
        await update({ status: "failed", stage: error.stage || "failed", failureReason: error.message, completedAt: new Date() });
        await log(error.message, "error");
        emitDeploymentEvent(deployment._id, "deployment:failure", deployment);
        await Project.updateOne({ _id: project._id }, { status: "failed" });
    }
};

export const deployRepositoryForUser = async (req, res) => {
    try {
        const { githubUrl, name, port = 3000 } = req.body;
        let url;
        try { url = new URL(githubUrl); } catch { return res.status(400).json({ success: false, message: "Enter a valid GitHub repository URL" }); }
        if (url.hostname !== "github.com" || url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname)) return res.status(400).json({ success: false, message: "Use a public HTTPS GitHub repository URL" });
        if (name !== undefined && (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 80)) return res.status(400).json({ success: false, message: "Project name must be between 1 and 80 characters" });
        if (!Number.isInteger(port) || port < 1 || port > 65535) return res.status(400).json({ success: false, message: "Port must be between 1 and 65535" });
        const project = await Project.create({ userId: req.user.userId, name: (name || url.pathname.split("/")[2]).slice(0, 80), githubUrl, status: "pending" });
        const deployment = await Deployment.create({ projectId: project._id, version: "latest", status: "pending", startedAt: new Date(), hostPort: 3001 + Math.floor(Math.random() * 20000), containerPort: port });
        void runDeployment(deployment, project, deployment.hostPort, port);
        return res.status(202).json({ success: true, project, deployment });
    } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
};

export const redeployProject = async (req, res) => {
    try {
        const project = await findOwnedProject(req.params.projectId, req.user.userId);
        if (!project) return res.status(404).json({ success: false, message: "Project not found" });
        const port = Number(req.body?.port || project.detectedPort || 3000);
        if (!Number.isInteger(port) || port < 1 || port > 65535) return res.status(400).json({ success: false, message: "Port must be between 1 and 65535" });
        const hostPort = 3001 + Math.floor(Math.random() * 20000);
        const deployment = await Deployment.create({ projectId: project._id, version: "latest", status: "pending", stage: "queued", startedAt: new Date(), hostPort, containerPort: port });
        void runDeployment(deployment, project, hostPort, port);
        return res.status(202).json({ success: true, deployment });
    } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
};

// CREATE DEPLOYMENT
export const createDeployment = async (req, res) => {
    try {
        const { projectId, version, commitId } = req.body;

        if (!projectId || !version) {
            return res.status(400).json({
                success: false,
                message: "projectId and version are required"
            });
        }

        if (!isValidId(projectId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid project ID"
            });
        }

        const project = await findOwnedProject(
            projectId,
            req.user.userId
        );

        if (!project) {
            return res.status(404).json({
                success: false,
                message: "Project not found"
            });
        }

        const deployment = await Deployment.create({
            projectId: project._id,
            version,
            commitId: commitId || null,
            status: "pending",
            startedAt: new Date(),
            hostPort: 3001 + Math.floor(Math.random() * 20000),
            containerPort: project.detectedPort || 3000
        });

        void runDeployment(deployment, project, deployment.hostPort, deployment.containerPort);

        return res.status(201).json({
            success: true,
            message: "Deployment created successfully",
            deployment
        });

    } catch (error) {
        console.error("Create Deployment Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to create deployment"
        });
    }
};


// GET ALL DEPLOYMENTS FOR A PROJECT
export const getProjectDeployments = async (req, res) => {
    try {
        const { projectId } = req.params;

        if (!isValidId(projectId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid project ID"
            });
        }

        const project = await findOwnedProject(
            projectId,
            req.user.userId
        );

        if (!project) {
            return res.status(404).json({
                success: false,
                message: "Project not found"
            });
        }

        const deployments = await Deployment.find({
            projectId: project._id
        }).sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            count: deployments.length,
            deployments
        });

    } catch (error) {
        console.error("Get Project Deployments Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch deployments"
        });
    }
};


// GET ONE DEPLOYMENT
export const getDeploymentById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!isValidId(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid deployment ID"
            });
        }

        // Find only a deployment belonging to the logged-in user
        const deployment = await Deployment.findById(id)
            .populate({
                path: "projectId",
                select: "name githubUrl userId"
            });

        if (!deployment || !deployment.projectId) {
            return res.status(404).json({
                success: false,
                message: "Deployment or associated project not found"
            });
        }

        if (
            deployment.projectId.userId.toString() !==
            req.user.userId.toString()
        ) {
            return res.status(403).json({
                success: false,
                message: "Unauthorized access"
            });
        }

        return res.status(200).json({
            success: true,
            deployment
        });

    } catch (error) {
        console.error("Get Deployment Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch deployment"
        });
    }
};


// GET DEPLOYMENT STATUS
export const getDeploymentStatus = async (req, res) => {
    try {
        const { id } = req.params;

        if (!isValidId(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid deployment ID"
            });
        }

        const deployment = await Deployment.findById(id)
            .populate({
                path: "projectId",
                select: "name userId"
            });

        if (!deployment || !deployment.projectId) {
            return res.status(404).json({
                success: false,
                message: "Deployment or associated project not found"
            });
        }

        if (
            deployment.projectId.userId.toString() !==
            req.user.userId.toString()
        ) {
            return res.status(403).json({
                success: false,
                message: "Unauthorized access"
            });
        }

        return res.status(200).json({
            success: true,
            deploymentId: String(deployment._id),
            status: deployment.status,
            stage: deployment.stage,
            publicUrl: deployment.publicUrl,
            publicCheck: deployment.publicCheck,
            failureReason: deployment.failureReason,
            retryCount: deployment.retryCount,
            startedAt: deployment.startedAt,
            completedAt: deployment.completedAt
        });

    } catch (error) {
        console.error("Get Deployment Status Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch deployment status"
        });
    }
};

export const getDeploymentLogs = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid deployment ID" });
        const deployment = await Deployment.findById(req.params.id).populate("projectId", "userId");
        if (!deployment?.projectId || deployment.projectId.userId.toString() !== req.user.userId.toString()) return res.status(404).json({ success: false, message: "Deployment not found" });
        const logs = await DeploymentLog.find({ deploymentId: deployment._id }).sort({ createdAt: 1 }).limit(1000);
        return res.json({ success: true, logs });
    } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
};

export const getUserDeployments = async (req, res) => {
    try {
        const projects = await Project.find({ userId: req.user.userId }).select("_id");
        const deployments = await Deployment.find({ projectId: { $in: projects.map(p => p._id) } }).sort({ createdAt: -1 }).limit(100);
        res.json({ success: true, deployments });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};


// ROLLBACK DEPLOYMENT RECORD
export const rollbackDeployment = async (req, res) => {
    try {
        const { id } = req.params;

        if (!isValidId(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid deployment ID"
            });
        }

        const deployment = await Deployment.findById(id)
            .populate({
                path: "projectId",
                select: "name userId"
            });

        if (!deployment || !deployment.projectId) {
            return res.status(404).json({
                success: false,
                message: "Deployment or associated project not found"
            });
        }

        if (
            deployment.projectId.userId.toString() !==
            req.user.userId.toString()
        ) {
            return res.status(403).json({
                success: false,
                message: "Unauthorized access"
            });
        }

        if (deployment.status !== "success") {
            return res.status(400).json({
                success: false,
                message: "Only successful deployments can be rolled back"
            });
        }

        const previousDeployment = await Deployment.findOne({ projectId: deployment.projectId._id, status: "success", _id: { $ne: deployment._id } }).sort({ completedAt: -1 });
        if (!previousDeployment?.containerId || !previousDeployment.hostPort) return res.status(409).json({ success: false, message: "No previous verified running release is available to roll back to" });
        const previousPath = previousDeployment.healthCheck?.url ? new URL(previousDeployment.healthCheck.url).pathname : "/";
        const previousHealth = await checkApplicationHealth(previousDeployment.hostPort, { attempts: 3, intervalMs: 500, path: previousPath });
        if (!previousHealth.success) return res.status(409).json({ success: false, message: "The previous release is not healthy; the current release was left running" });
        if (deployment.containerId) await removeDockerContainer(deployment.containerId);
        await stopTunnel(String(deployment._id));

        deployment.status = "rolled_back";
        deployment.publicUrl = null;
        deployment.localUrl = null;
        deployment.completedAt = new Date();

        await deployment.save();
        await Project.updateOne({ _id: deployment.projectId._id }, { status: "deployed" });

        return res.status(200).json({
            success: true,
            message: "Rolled back to the previous verified deployment",
            deployment,
            previousDeployment,
            localUrl: previousDeployment.localUrl,
            publicUrl: previousDeployment.publicUrl
        });

    } catch (error) {
        console.error("Rollback Deployment Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to rollback deployment"
        });
    }
};
