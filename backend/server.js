import dotenv from "dotenv";
import mongoose from "mongoose";
import express from "express";
import logger from "./src/config/logger.js";
import env from "./src/config/env.js";
import authrouter from "./src/routes/authroute.js";

dotenv.config();

const app = express();

// Middleware
app.use(express.json());

// Port
const PORT = env.PORT ;

app.use("/auth", authrouter)
// MongoDB Connection

mongoose.connect(env.MONGO_URI)
    .then(() => {
        logger.info("MongoDB Connected Successfully!");
    })
    .catch((error) => {
        logger.error("MongoDB connection failed", {
            message: error.message,
            stack: error.stack
        });
    });

// // Test route
// app.get("/", (req, res) => {
//     res.status(200).json({
//         message: "AI DevOps Agent API is running"
//     });
// });

// Start server
app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
});