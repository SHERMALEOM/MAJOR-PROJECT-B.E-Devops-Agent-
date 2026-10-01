import mongoose from "mongoose";

const projectSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    name: {
      type: String,
      required: true,
      trim: true
    },

    githubUrl: {
      type: String,
      required: true,
      trim: true
    },

    branch: {
      type: String,
      default: "main",
      trim: true
    },

    language: {
      type: String,
      default: null
    },

    framework: {
      type: String,
      default: null
    },

    packageManager: {
      type: String,
      default: null
    },

    detectedPort: {
      type: Number,
      default: null
    },

    status: {
      type: String,
      enum: [
        "pending",
        "analyzing",
        "ready",
        "deploying",
        "deployed",
        "failed"
      ],
      default: "pending"
    }
  },
  {
    timestamps: true
  }
);

const Project = mongoose.model("Project", projectSchema);

export default Project;