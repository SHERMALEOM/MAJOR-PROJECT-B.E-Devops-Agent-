import jwt from "jsonwebtoken";
import env from "../config/env.js";

const authMiddleware = (req, res, next) => {
    try {
        // Get token from request
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({
                message: "Please login first"
            });
        }

        // Get only the JWT token
        const token = authHeader.split(" ")[1];

        // Verify token
        const user = jwt.verify(token, env.JWT_SECRET);

        // Store user information in request
        req.user = user;

        // Continue to controller
        next();

    } catch (error) {
        return res.status(401).json({
            message: "Invalid or expired token"
        });
    }
};

export default authMiddleware;