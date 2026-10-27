import Deployment from "../../models/deploymentmodel.js";

export const releaseRollback = async state => {
    const previous = await Deployment.findOne({ projectId: state.projectId, status: "success", _id: { $ne: state.deploymentId } }).sort({ completedAt: -1 });
    const release = { deploymentId: state.deploymentId, imageName: state.imageName, containerId: state.containerId, localUrl: state.healthCheck?.url, publicUrl: state.publicUrl, verifiedAt: state.healthCheck?.checkedAt || new Date() };
    return { release, previousRelease: previous ? { deploymentId: String(previous._id), containerId: previous.containerId, localUrl: previous.localUrl, imageName: previous.dockerImage } : null, workflowStage: "release-tracking", status: "success" };
};
