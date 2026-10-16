
import mongoose from "mongoose";
import Deployment from "../models/deploymentmodel.js";
import Project from "../models/projectmodel.js";

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
            startedAt: new Date()
        });

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
            status: deployment.status,
            publicUrl: deployment.publicUrl,
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

        // This updates the database record only.
        // Actual Docker rollback must be implemented in a deployment service.
        deployment.status = "rolled_back";
        deployment.completedAt = new Date();

        await deployment.save();

        return res.status(200).json({
            success: true,
            message: "Deployment record marked as rolled back",
            deployment
        });

    } catch (error) {
        console.error("Rollback Deployment Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to rollback deployment"
        });
    }
};
