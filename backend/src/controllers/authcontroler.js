import User from "../models/usermodel.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import logger from "../config/logger.js";
import env from "../config/env.js";

// Register
export const registerUser = async (req, res) => {
  try {
    const {name,email,password}=req.body;


    // Check if user already exists
    const existingUser = await User.findOne({ email });
    // const sameUser= await user.findOne({email})

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User already exists"
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await User.create({
      name,
      email,
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
    logger.error("Registration failed", {
      message: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      message: "Registration failed"
    });
  }
};


// Login
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ email });

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
      { userId: user._id },
       env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("token", token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000
});

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
    logger.error("Login failed", {
      message: error.message,
      stack: error.stack
    });

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
            message: error.message
        });
    }
};


// Logout user
export const logout = async (req, res) => {
    try {
        res.clearCookie("token", {
            httpOnly: true,
            secure: env.NODE_ENV === "production",
            sameSite: "strict"
        });

        res.status(200).json({
            success: true,
            message: "Logged out successfully"
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};