import express from "express";
import authMiddleware from "../middleware/authmiddleware.js";


import {
    createProject,
    getProjects,
    getProject,
    deleteProject
} from  "../controllers/projectController.js"

const projectrouter = express.Router();

// Create a new project
projectrouter.post("/", authMiddleware, createProject);

// Get all projects of logged-in user
projectrouter.get("/", authMiddleware, getProjects);

// Get a single project
projectrouter.get("/:id", authMiddleware, getProject);

// Delete a project
projectrouter.delete("/:id", authMiddleware, deleteProject);

export default projectrouter;