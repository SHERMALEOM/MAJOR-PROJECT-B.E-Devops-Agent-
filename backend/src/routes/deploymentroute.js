
import express from "express";

import authMiddleware from "../middleware/authmiddleware.js";

import {
    createDeployment,
    getProjectDeployments,
    getDeploymentById,
    getDeploymentStatus,
    rollbackDeployment,
    getDeploymentLogs,
    getUserDeployments,
    deployRepositoryForUser,
    redeployProject
} from "../controllers/deploymentController.js";

const deploymentrouter = express.Router();

deploymentrouter.post("/from-repository", authMiddleware, deployRepositoryForUser);
deploymentrouter.get("/", authMiddleware, getUserDeployments);
deploymentrouter.get("/:id/logs", authMiddleware, getDeploymentLogs);
deploymentrouter.post("/project/:projectId/redeploy", authMiddleware, redeployProject);

// Create a deployment
deploymentrouter.post(
    "/",
    authMiddleware,
    createDeployment
);

// Get all deployments for a project
deploymentrouter.get(
    "/project/:projectId",
    authMiddleware,
    getProjectDeployments
);

// Get deployment status
deploymentrouter.get(
    "/:id/status",
    authMiddleware,
    getDeploymentStatus
);

// Get one deployment by ID
deploymentrouter.get(
    "/:id",
    authMiddleware,
    getDeploymentById
);

// Rollback a deployment
deploymentrouter.post(
    "/:id/rollback",
    authMiddleware,
    rollbackDeployment
);

export default deploymentrouter;
