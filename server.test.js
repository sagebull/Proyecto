const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");

let serverProcess;
let databaseDirectory;
let baseUrl;

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("Server did not start in time.")), 10000);

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(/Backoffice listo en (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    child.stderr.on("data", () => {});
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited before starting with code ${code}.`));
    });
  });
}

before(async () => {
  databaseDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "lugunica-backoffice-"));
  serverProcess = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: {
      ...process.env,
      DATABASE_PATH: path.join(databaseDirectory, "test.sqlite"),
      HOST: "127.0.0.1",
      PORT: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  baseUrl = await waitForServer(serverProcess);
});

after(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    const exited = once(serverProcess, "exit");
    serverProcess.kill();
    await exited;
  }
  if (databaseDirectory) await fs.rm(databaseDirectory, { recursive: true, force: true });
});

async function postJson(pathname, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["auth-token"] = token;
  return fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
}

test("SQLite API supports registration, login, protected project CRUD, and logout", async () => {
  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Lugunica/);

  const unauthenticated = await fetch(`${baseUrl}/api/v1/projects`);
  assert.equal(unauthenticated.status, 401);

  const registration = await postJson("/api/v1/auth/register", {
    name: "Emilia Lugunica",
    email: "emilia@example.com",
    itsonId: "123456",
    password: "secret6"
  });
  assert.equal(registration.status, 201);
  const user = await registration.json();
  assert.ok(user.id);
  assert.equal(user.password, undefined);

  const invalidLogin = await postJson("/api/v1/auth/login", {
    email: user.email,
    password: "wrongpass"
  });
  assert.equal(invalidLogin.status, 401);

  const login = await postJson("/api/v1/auth/login", {
    email: user.email,
    password: "secret6"
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  assert.ok(session.token);
  assert.equal(session.user.id, user.id);

  const create = await postJson("/api/v1/projects", {
    title: "Mansion Roswaal",
    description: "Proyecto inicial",
    userId: "untrusted-user",
    technologies: ["HTML", "CSS"]
  }, session.token);
  assert.equal(create.status, 201);
  const project = await create.json();
  assert.equal(project.userId, user.id);
  assert.deepEqual(project.technologies, ["HTML", "CSS"]);

  const projectDetails = await fetch(`${baseUrl}/api/v1/projects/${project._id}`, {
    headers: { "auth-token": session.token }
  });
  assert.equal(projectDetails.status, 200);
  assert.equal((await projectDetails.json()).title, "Mansion Roswaal");

  const list = await fetch(`${baseUrl}/api/v1/projects`, {
    headers: { "auth-token": session.token }
  });
  assert.equal(list.status, 200);
  assert.equal((await list.json()).length, 1);

  const secondRegistration = await postJson("/api/v1/auth/register", {
    name: "Beatrice Lugu",
    email: "beatrice@example.com",
    itsonId: "654321",
    password: "secret6"
  });
  assert.equal(secondRegistration.status, 201);
  const secondUser = await secondRegistration.json();
  const secondLogin = await postJson("/api/v1/auth/login", {
    email: secondUser.email,
    password: "secret6"
  });
  const secondSession = await secondLogin.json();
  const secondUsersProjects = await fetch(`${baseUrl}/api/v1/projects`, {
    headers: { "auth-token": secondSession.token }
  });
  assert.equal(secondUsersProjects.status, 200);
  assert.deepEqual(await secondUsersProjects.json(), []);

  const privateProject = await fetch(`${baseUrl}/api/v1/projects/${project._id}`, {
    headers: { "auth-token": secondSession.token }
  });
  assert.equal(privateProject.status, 404);

  const update = await fetch(`${baseUrl}/api/v1/projects/${project._id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "auth-token": session.token },
    body: JSON.stringify({ title: "Mansion renovada" })
  });
  assert.equal(update.status, 200);
  assert.equal((await update.json()).title, "Mansion renovada");

  const remove = await fetch(`${baseUrl}/api/v1/projects/${project._id}`, {
    method: "DELETE",
    headers: { "auth-token": session.token }
  });
  assert.equal(remove.status, 200);

  const logout = await postJson("/api/v1/auth/logout", {}, session.token);
  assert.equal(logout.status, 200);
  const revokedSession = await fetch(`${baseUrl}/api/v1/projects`, {
    headers: { "auth-token": session.token }
  });
  assert.equal(revokedSession.status, 401);
});
