
import dotenv from "dotenv";
import express from "express";
import { createServer } from "node:http";

import { initializeDeploymentSocket } from "./src/sockets/deploymentSocket.js";
import connectDatabase from "./src/config/db.js";
import logger from "./src/config/logger.js";
import env from "./src/config/env.js";

import authrouter from "./src/routes/authroute.js";
import projectrouter from "./src/routes/projectroute.js";
import deploymentrouter from "./src/routes/deploymentroute.js";

import { stopAllTunnels } from "./src/services/cloudflare/tunnelService.js";

dotenv.config();

const app = express();
const httpServer = createServer(app);

// Initialize Socket.IO for deployment logs
initializeDeploymentSocket(httpServer);

// Middleware
app.use(express.json());

// CORS configuration
const allowedOrigins = [
    "http://localhost:5173",
    "http://localhost:5174",
];

app.use((req, res, next) => {
    const origin = req.headers.origin;

    if (origin && allowedOrigins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
    }

    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
    );
    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    );

    // Handle browser preflight requests
    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();
});

// Root route
app.get("/", (_req, res) => {
    res.json({
        success: true,
        message: "AI DevOps Agent API is running",
    });
});

// API routes
app.use("/auth", authrouter);
app.use("/project", projectrouter);
app.use("/deployment", deploymentrouter);

// Server configuration
const PORT = env.PORT || 5000;

// Validate required environment variables
if (!env.JWT_SECRET) {
    throw new Error("JWT_SECRET is required to start the API");
}

// Start backend after database connection
connectDatabase()
    .then(() => {
        httpServer.listen(PORT, () => {
            logger.info(`Server running on port ${PORT}`);
        });
    })
    .catch((error) => {
        logger.error("Backend startup failed", {
            message: error.message,
        });
        process.exitCode = 1;
    });

// Graceful shutdown
let isShuttingDown = false;

const shutdown = (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`Received ${signal}; stopping Cloudflare Quick Tunnels`);

    const forceExit = setTimeout(() => {
        process.exit(1);
    }, 10000);

    forceExit.unref();

    void stopAllTunnels()
        .catch((error) => {
            logger.error("Error stopping Cloudflare tunnels", {
                message: error.message,
            });
        })
        .finally(() => {
            httpServer.close(() => {
                clearTimeout(forceExit);
                process.exit(0);
            });
        });
};

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
