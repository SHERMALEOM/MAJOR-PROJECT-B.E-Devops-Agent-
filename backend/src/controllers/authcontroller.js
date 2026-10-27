import User from "../models/usermodel.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import logger from "../config/logger.js";
import env from "../config/env.js";

// Register
export const registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const normalizedName = typeof name === "string" ? name.trim() : "";
    if (!normalizedName || normalizedName.length > 80) return res.status(400).json({ success: false, message: "Name is required and must be at most 80 characters" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) return res.status(400).json({ success: false, message: "Enter a valid email address" });
    if (typeof password !== "string" || password.length < 8 || Buffer.byteLength(password, "utf8") > 72) return res.status(400).json({ success: false, message: "Password must be at least 8 characters and no more than 72 bytes" });

    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "User already exists"
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await User.create({
      name: normalizedName,
      email: normalizedEmail,
      password: hashedPassword
    });

    logger.info(`User registered: ${user.email}`);

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });

  } catch (error) {
    logger.error("Registration failed", { message: error.message });
    if (error.code === 11000) return res.status(409).json({ success: false, message: "An account with this email already exists" });

    res.status(500).json({
      success: false,
      message: "Registration failed"
    });
  }
};


// Login
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || typeof password !== "string" || !password || Buffer.byteLength(password, "utf8") > 72) return res.status(400).json({ success: false, message: "Enter a valid email address and password" });

    const user = await User.findOne({ email: normalizedEmail }).select("+password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    // Compare password
    const isPasswordCorrect = await bcrypt.compare(
      password,
      user.password
    );

    if (!isPasswordCorrect) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    // Create JWT
    const token = jwt.sign(
      { userId: user._id.toString(), tokenVersion: user.tokenVersion || 0 },
       env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    logger.info(`User logged in: ${user.email}`);

    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });

  } catch (error) {
    logger.error("Login failed", { message: error.message });

    res.status(500).json({
      success: false,
      message: "Login failed"
    });
  }
};



// Get currently logged-in user
export const getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user.userId)
            .select("-password");

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        res.status(200).json({
            success: true,
            user
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Unable to load the current user"
        });
    }
};


// Logout user
export const logout = async (req, res) => {
    try {
        await User.updateOne({ _id: req.user.userId }, { $inc: { tokenVersion: 1 } });
        res.status(200).json({
            success: true,
            message: "Logged out successfully"
        });

    } catch (error) {
        logger.error("Logout failed", { message: error.message });
        res.status(500).json({
            success: false,
            message: "Logout failed"
        });
    }
};
