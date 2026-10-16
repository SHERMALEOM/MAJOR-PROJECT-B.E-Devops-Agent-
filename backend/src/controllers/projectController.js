
import Project from "../models/projectmodel.js";

// Api testing is remaining  

// CREATE PROJECT

export const createProject = async (req, res) => {
    try {
        const { name, githubUrl, branch } = req.body;

        const project = await Project.create({
            userId: req.user.userId,
            name,
            githubUrl,
            branch: branch || "main"
        });

        res.status(201).json({
            success: true,
            message: "Project created successfully",
            project
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};


// GET ALL PROJECTS
export const getProjects = async (req, res) => {
    try {
        const projects = await Project.find({
            userId: req.user.userId
        });

        res.status(200).json({
            success: true,
            projects
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};


// GET ONE PROJECT
export const getProject = async (req, res) => {
    try {
        const project = await Project.findOne({
            _id: req.params.id,
            userId: req.user.userId
        });

        if (!project) {
            return res.status(404).json({
                success: false,
                message: "Project not found"
            });
        }

        res.status(200).json({
            success: true,
            project
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};


// DELETE PROJECT
export const deleteProject = async (req, res) => {
    try {
        const project = await Project.findOneAndDelete({
            _id: req.params.id,
            userId: req.user.userId
        });

        if (!project) {
            return res.status(404).json({
                success: false,
                message: "Project not found"
            });
        }

        res.status(200).json({
            success: true,
            message: "Project deleted successfully"
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};