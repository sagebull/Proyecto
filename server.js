const { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } = require("node:crypto");
const { createServer } = require("node:http");
const { DatabaseSync } = require("node:sqlite");
const { promisify } = require("node:util");
const fs = require("node:fs");
const path = require("node:path");

const scryptAsync = promisify(scrypt);
const databasePath = process.env.DATABASE_PATH || path.join(__dirname, "data", "backoffice.sqlite");
const databaseDirectory = path.dirname(databasePath);

fs.mkdirSync(databaseDirectory, { recursive: true });

const db = new DatabaseSync(databasePath);
db.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const staticFiles = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/login.html", "login.html"],
  ["/register.html", "register.html"],
  ["/home.html", "home.html"],
  ["/styles.css", "styles.css"],
  ["/app.js", "app.js"]
]);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(data === null ? "" : JSON.stringify(data));
}

async function readJson(request) {
  const contentType = request.headers["content-type"]?.split(";")[0].trim();
  if (contentType !== "application/json") {
    throw new HttpError(415, "El contenido debe ser JSON.");
  }

  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 1_000_000) throw new HttpError(413, "La solicitud es demasiado grande.");
    chunks.push(chunk);
  }

  let data;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "El JSON enviado no es valido.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpError(400, "El cuerpo JSON debe ser un objeto.");
  }
  return data;
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = await scryptAsync(password, salt, 64);
  return `${salt}:${hash.toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
  const [salt, savedHash] = storedHash.split(":");
  if (!salt || !savedHash) return false;
  const actualHash = await scryptAsync(password, salt, 64);
  const expectedHash = Buffer.from(savedHash, "hex");
  return expectedHash.length === actualHash.length && timingSafeEqual(expectedHash, actualHash);
}

function validateEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function toProject(row) {
  return {
    _id: row.id,
    title: row.title,
    description: row.description,
    userId: row.user_id,
    technologies: JSON.parse(row.technologies),
    repository: row.repository,
    images: JSON.parse(row.images)
  };
}

function validateProject(data, current = null) {
  const title = data.title === undefined ? current?.title : data.title;
  const description = data.description === undefined ? current?.description : data.description;
  const technologies = data.technologies === undefined ? current?.technologies ?? [] : data.technologies;
  const repository = data.repository === undefined ? current?.repository ?? "" : data.repository;
  const images = data.images === undefined ? current?.images ?? [] : data.images;

  if (typeof title !== "string" || !title.trim() || title.length > 120) {
    throw new HttpError(400, "El titulo es obligatorio y no puede superar 120 caracteres.");
  }
  if (typeof description !== "string" || !description.trim() || description.length > 2000) {
    throw new HttpError(400, "La descripcion es obligatoria y no puede superar 2000 caracteres.");
  }
  if (!Array.isArray(technologies) || technologies.some((item) => typeof item !== "string")) {
    throw new HttpError(400, "Las tecnologias deben enviarse como una lista de texto.");
  }
  if (typeof repository !== "string") {
    throw new HttpError(400, "El repositorio debe ser una URL de texto.");
  }
  if (repository) {
    let url;
    try {
      url = new URL(repository);
    } catch {
      throw new HttpError(400, "El repositorio debe ser una URL valida.");
    }
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new HttpError(400, "El repositorio debe usar HTTP o HTTPS.");
    }
  }
  if (!Array.isArray(images) || images.some((item) => typeof item !== "string")) {
    throw new HttpError(400, "Las imagenes deben enviarse como una lista de texto.");
  }

  return {
    title: title.trim(),
    description: description.trim(),
    technologies: technologies.map((item) => item.trim()).filter(Boolean),
    repository,
    images
  };
}

function getAuthenticatedUser(request) {
  const token = request.headers["auth-token"];
  if (typeof token !== "string" || !token) {
    throw new HttpError(401, "Inicia sesion para continuar.");
  }

  const row = db.prepare(`
    SELECT users.id, users.name, users.email, users.itson_id
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(hashToken(token), new Date().toISOString());

  if (!row) throw new HttpError(401, "La sesion no es valida. Inicia sesion de nuevo.");
  return { id: row.id, name: row.name, email: row.email, itsonId: row.itson_id };
}

async function register(request, response) {
  const data = await readJson(request);
  const name = typeof data.name === "string" ? data.name.trim() : "";
  const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
  const itsonId = typeof data.itsonId === "string" ? data.itsonId.trim() : "";
  const password = typeof data.password === "string" ? data.password : "";

  if (name.length < 6) throw new HttpError(400, "El nombre debe tener al menos 6 caracteres.");
  if (!validateEmail(email)) throw new HttpError(400, "Ingresa un correo valido.");
  if (!/^\d{6}$/.test(itsonId)) throw new HttpError(400, "El numero ITSON debe tener 6 digitos.");
  if (password.length < 6) throw new HttpError(400, "La contrasena debe tener al menos 6 caracteres.");

  const passwordHash = await hashPassword(password);
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) {
    throw new HttpError(409, "Ya existe una cuenta con ese correo.");
  }
  if (db.prepare("SELECT 1 FROM users WHERE itson_id = ?").get(itsonId)) {
    throw new HttpError(409, "Ese numero ITSON ya esta registrado.");
  }

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, name, email, itson_id, password_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name, email, itsonId, passwordHash, createdAt);

  sendJson(response, 201, { id, name, email, itsonId });
}

async function login(request, response) {
  const data = await readJson(request);
  const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
  const password = typeof data.password === "string" ? data.password : "";
  const user = db.prepare(`
    SELECT id, name, email, itson_id, password_hash
    FROM users
    WHERE email = ?
  `).get(email);

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw new HttpError(401, "Correo o contrasena incorrectos.");
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).run(hashToken(token), user.id, expiresAt, new Date().toISOString());

  sendJson(response, 200, {
    token,
    user: { id: user.id, name: user.name, email: user.email, itsonId: user.itson_id }
  });
}

function listProjects(user) {
  const rows = db.prepare(`
    SELECT id, user_id, title, description, technologies, repository, images
    FROM projects
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(user.id);
  return rows.map(toProject);
}

function createProject(request, response, user) {
  return readJson(request).then((data) => {
    const project = validateProject(data);
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO projects (
        id, user_id, title, description, technologies, repository, images, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      user.id,
      project.title,
      project.description,
      JSON.stringify(project.technologies),
      project.repository,
      JSON.stringify(project.images),
      now,
      now
    );
    const row = db.prepare(`
      SELECT id, user_id, title, description, technologies, repository, images
      FROM projects WHERE id = ?
    `).get(id);
    sendJson(response, 201, toProject(row));
  });
}

async function updateProject(request, response, user, id) {
  const currentRow = db.prepare(`
    SELECT id, user_id, title, description, technologies, repository, images
    FROM projects
    WHERE id = ? AND user_id = ?
  `).get(id, user.id);
  if (!currentRow) throw new HttpError(404, "No se encontro el proyecto.");

  const current = toProject(currentRow);
  const project = validateProject(await readJson(request), current);
  db.prepare(`
    UPDATE projects
    SET title = ?, description = ?, technologies = ?, repository = ?, images = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(
    project.title,
    project.description,
    JSON.stringify(project.technologies),
    project.repository,
    JSON.stringify(project.images),
    new Date().toISOString(),
    id,
    user.id
  );

  const updatedRow = db.prepare(`
    SELECT id, user_id, title, description, technologies, repository, images
    FROM projects WHERE id = ? AND user_id = ?
  `).get(id, user.id);
  sendJson(response, 200, toProject(updatedRow));
}

async function handleApi(request, response, url) {
  const { pathname } = url;

  if (request.method === "POST" && pathname === "/api/v1/auth/register") {
    await register(request, response);
    return;
  }
  if (request.method === "POST" && pathname === "/api/v1/auth/login") {
    await login(request, response);
    return;
  }
  if (request.method === "POST" && pathname === "/api/v1/auth/logout") {
    getAuthenticatedUser(request);
    db.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .run(hashToken(request.headers["auth-token"]));
    sendJson(response, 200, { message: "Sesion cerrada." });
    return;
  }

  const user = getAuthenticatedUser(request);

  if (request.method === "GET" && pathname === "/api/v1/projects") {
    sendJson(response, 200, listProjects(user));
    return;
  }
  if (request.method === "POST" && pathname === "/api/v1/projects") {
    await createProject(request, response, user);
    return;
  }

  const projectMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)$/);
  if (projectMatch) {
    const id = decodeURIComponent(projectMatch[1]);
    if (request.method === "GET") {
      const row = db.prepare(`
        SELECT id, user_id, title, description, technologies, repository, images
        FROM projects WHERE id = ? AND user_id = ?
      `).get(id, user.id);
      if (!row) throw new HttpError(404, "No se encontro el proyecto.");
      sendJson(response, 200, toProject(row));
      return;
    }
    if (request.method === "PUT") {
      await updateProject(request, response, user, id);
      return;
    }
    if (request.method === "DELETE") {
      const result = db.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?").run(id, user.id);
      if (result.changes === 0) throw new HttpError(404, "No se encontro el proyecto.");
      sendJson(response, 200, { message: "Proyecto eliminado." });
      return;
    }
  }

  throw new HttpError(404, "La ruta solicitada no existe.");
}

async function handleRequest(request, response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "same-origin");
  const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);

  if (url.pathname.startsWith("/api/")) {
    await handleApi(request, response, url);
    return;
  }

  const fileName = staticFiles.get(url.pathname);
  if (!fileName || !["GET", "HEAD"].includes(request.method)) {
    throw new HttpError(fileName ? 405 : 404, "No se encontro la pagina solicitada.");
  }

  const filePath = path.join(__dirname, fileName);
  const content = await fs.promises.readFile(filePath);
  response.writeHead(200, {
    "Cache-Control": "no-cache",
    "Content-Length": content.length,
    "Content-Type": mimeTypes[path.extname(fileName)]
  });
  response.end(request.method === "HEAD" ? undefined : content);
}

const server = createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    const status = error instanceof HttpError ? error.status : 500;
    if (status >= 500) console.error(error);
    if (!response.headersSent) {
      sendJson(response, status, { message: status === 500 ? "Error interno del servidor." : error.message });
    } else {
      response.destroy();
    }
  });
});

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);

server.listen(port, host, () => {
  const address = server.address();
  console.log(`Backoffice listo en http://${host}:${address.port}`);
});

function closeServer() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", closeServer);
process.on("SIGTERM", closeServer);
