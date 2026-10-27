import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import env from "../config/env.js";
import Deployment from "../models/deploymentmodel.js";
import User from "../models/usermodel.js";

let io;
export const initializeDeploymentSocket = (httpServer) => {
    io = new Server(httpServer, { cors: { origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173", methods: ["GET", "POST"] } });
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth?.token;
            if (!token) return next(new Error("Authentication required"));
            socket.data.user = jwt.verify(token, env.JWT_SECRET);
            const storedUser = await User.findById(socket.data.user.userId).select("tokenVersion");
            if (!storedUser || (socket.data.user.tokenVersion || 0) !== (storedUser.tokenVersion || 0)) return next(new Error("Invalid or expired token"));
            next();
        } catch { next(new Error("Invalid or expired token")); }
    });
    io.on("connection", socket => {
        socket.on("deployment:join", async deploymentId => {
            try {
                if (!/^[a-f\d]{24}$/i.test(String(deploymentId))) return socket.emit("deployment:error", { message: "Invalid deployment ID" });
                const deployment = await Deployment.findById(deploymentId).populate("projectId", "userId");
                if (!deployment?.projectId || deployment.projectId.userId.toString() !== socket.data.user.userId.toString()) return socket.emit("deployment:error", { message: "Deployment not found" });
                socket.join(`deployment:${deploymentId}`);
                socket.emit("deployment:joined", { deploymentId });
            } catch { socket.emit("deployment:error", { message: "Unable to join deployment" }); }
        });
        socket.on("deployment:leave", deploymentId => socket.leave(`deployment:${deploymentId}`));
    });
    return io;
};
export const emitDeploymentEvent = (deploymentId, event, payload) => io?.to(`deployment:${deploymentId}`).emit(event, payload);
