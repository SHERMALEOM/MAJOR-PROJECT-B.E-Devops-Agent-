import jwt from "jsonwebtoken";
import env from "../config/env.js";
import User from "../models/usermodel.js";

const authMiddleware = async (req, res, next) => {
    try {
        // Get token from request
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({
                success: false,
                message: "Please login first"
            });
        }

        // Get only the JWT token
        const [scheme, token] = authHeader.split(" ");
        if (scheme !== "Bearer" || !token) return res.status(401).json({ success: false, message: "Please login first" });

        // Verify token
        const user = jwt.verify(token, env.JWT_SECRET);
        const storedUser = await User.findById(user.userId).select("tokenVersion");
        if (!storedUser || (user.tokenVersion || 0) !== (storedUser.tokenVersion || 0)) return res.status(401).json({ success: false, message: "Invalid or expired token" });

        // Store user information in request
        req.user = user;

        // Continue to controller
        next();

    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired token"
        });
    }
};

export default authMiddleware;
