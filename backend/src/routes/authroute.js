import express from "express";
import authMiddleware from "../middleware/authmiddleware.js";

import {
    registerUser,
    loginUser,
    getMe,
    logout
} from "../controllers/authcontroller.js"

const authrouter = express.Router();

authrouter.post("/register", registerUser);
authrouter.post("/login", loginUser);
authrouter.get("/getme",authMiddleware,getMe );
authrouter.post("/logout",authMiddleware,logout );

export default authrouter;

