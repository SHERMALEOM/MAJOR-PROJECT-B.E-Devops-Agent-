import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

process.env.JWT_SECRET = "auth-unit-test-secret";
const [{ default: User }, { default: logger }, auth, { default: authMiddleware }] = await Promise.all([
    import("../src/models/usermodel.js"),
    import("../src/config/logger.js"),
    import("../src/controllers/authcontroller.js"),
    import("../src/middleware/authmiddleware.js")
]);

const users = new Map();
const original = { findOne: User.findOne, findById: User.findById, create: User.create, updateOne: User.updateOne, info: logger.info, error: logger.error };
logger.info = () => {};
logger.error = () => {};
const query = user => ({ select: async () => user, then: (resolve, reject) => Promise.resolve(user).then(resolve, reject) });
User.findOne = ({ email }) => query(users.get(email) || null);
User.findById = id => query([...users.values()].find(user => String(user._id) === String(id)) || null);
User.create = async value => {
    const user = { ...value, _id: new mongoose.Types.ObjectId(), tokenVersion: 0 };
    if (users.has(user.email)) throw Object.assign(new Error("duplicate"), { code: 11000 });
    users.set(user.email, user);
    return user;
};
User.updateOne = async ({ _id }) => {
    const user = [...users.values()].find(candidate => String(candidate._id) === String(_id));
    if (user) user.tokenVersion += 1;
    return { modifiedCount: user ? 1 : 0 };
};

const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const invoke = async (handler, req) => { const res = response(); await handler(req, res); return res; };
try {
    const invalidEmail = await invoke(auth.registerUser, { body: { name: "Student", email: "bad", password: "password123" } });
    assert.equal(invalidEmail.statusCode, 400);
    const shortPassword = await invoke(auth.registerUser, { body: { name: "Student", email: "student@example.test", password: "short" } });
    assert.equal(shortPassword.statusCode, 400);

    const registration = await invoke(auth.registerUser, { body: { name: "  Student  ", email: " Student@Example.Test ", password: "correct-horse-123" } });
    assert.equal(registration.statusCode, 201);
    assert.equal(registration.body.user.email, "student@example.test");
    assert.equal(registration.body.user.name, "Student");
    assert.equal("password" in registration.body.user, false);
    const savedUser = users.get("student@example.test");
    assert.notEqual(savedUser.password, "correct-horse-123");
    assert.equal(await bcrypt.compare("correct-horse-123", savedUser.password), true);

    const duplicate = await invoke(auth.registerUser, { body: { name: "Other", email: "STUDENT@example.test", password: "correct-horse-123" } });
    assert.equal(duplicate.statusCode, 409);
    const login = await invoke(auth.loginUser, { body: { email: " STUDENT@example.test ", password: "correct-horse-123" } });
    assert.equal(login.statusCode, 200);
    assert.equal(jwt.verify(login.body.token, process.env.JWT_SECRET).userId, String(savedUser._id));
    assert.equal("password" in login.body.user, false);
    const wrongPassword = await invoke(auth.loginUser, { body: { email: "student@example.test", password: "incorrect" } });
    assert.equal(wrongPassword.statusCode, 401);

    let nextCalled = false;
    const request = { headers: { authorization: `Bearer ${login.body.token}` } };
    await authMiddleware(request, response(), () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    const logout = await invoke(auth.logout, { user: { userId: String(savedUser._id) } });
    assert.equal(logout.statusCode, 200);
    const afterLogout = response();
    await authMiddleware({ headers: { authorization: `Bearer ${login.body.token}` } }, afterLogout, () => assert.fail("revoked token was accepted"));
    assert.equal(afterLogout.statusCode, 401);

    console.log("PASS: auth validation, registration, bcrypt hashing, duplicate rejection, login, token verification, and logout revocation");
} finally {
    User.findOne = original.findOne; User.findById = original.findById; User.create = original.create; User.updateOne = original.updateOne; logger.info = original.info; logger.error = original.error;
}
