import express from "express";
import authMiddleware from "../middleware/authmiddleware.js";


import {
    createProject,
    getProjects,
    getProject,
    deleteProject
} from  "../controllers/projectController.js"

const router = express.Router();

// Create a new project
router.post("/", authMiddleware, createProject);

// Get all projects of logged-in user
router.get("/", authMiddleware, getProjects);

// Get a single project
router.get("/:id", authMiddleware, getProject);

// Delete a project
router.delete("/:id", authMiddleware, deleteProject);

export default router;