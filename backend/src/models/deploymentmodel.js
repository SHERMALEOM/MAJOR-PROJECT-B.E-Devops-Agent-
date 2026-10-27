import mongoose from "mongoose";

const deploymentSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true
    },

    version: {
      type: String,
      required: true
    },

    commitId: {
      type: String,
      default: null
    },

    status: {
      type: String,
      enum: [
        "pending",
        "cloning",
        "analyzing",
        "building",
        "deploying",
        "verifying",
        "success",
        "failed",
        "rolled_back"
      ],
      default: "pending"
    },

    dockerImage: {
      type: String,
      default: null
    },

    containerId: {
      type: String,
      default: null
    },

    containerPort: {
      type: Number,
      default: null
    },

    publicUrl: {
      type: String,
      default: null
    },
    publicCheck: { type: mongoose.Schema.Types.Mixed, default: null },

    retryCount: {
      type: Number,
      default: 0
    },

    failureReason: {
      type: String,
      default: null
    },
    stage: { type: String, default: "queued" },
    detectedLanguages: { type: [String], default: [] },
    detectedFrameworks: { type: [String], default: [] },
    buildStrategy: { type: String, default: null },
    localUrl: { type: String, default: null },
    hostPort: { type: Number, default: null },
    healthCheck: { type: mongoose.Schema.Types.Mixed, default: null },
    previousDeploymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Deployment", default: null },

    startedAt: {
      type: Date,
      default: null
    },

    completedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

const Deployment = mongoose.model("Deployment", deploymentSchema);

export default Deployment;
