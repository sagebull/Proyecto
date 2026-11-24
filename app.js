const API_BASE = "/api/v1";
const TOKEN_KEY = "authToken";
const USER_KEY = "authUser";
const LOGOUT_ERROR_KEY = "logoutError";

function showMessage(element, message, isSuccess = false) {
  if (!element) return;
  element.textContent = message;
  element.hidden = false;
  element.classList.toggle("message-success", isSuccess);
}

function parseResponse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function apiRequest(path, options = {}, requiresAuth = false) {
  const headers = new Headers(options.headers || {});
  if (options.body) headers.set("Content-Type", "application/json");

  if (requiresAuth) {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      window.location.replace("login.html");
      throw new Error("Tu sesion termino. Inicia sesion para continuar.");
    }
    headers.set("auth-token", token);
  }

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = parseResponse(await response.text());

  if (!response.ok) {
    if (requiresAuth && (response.status === 401 || response.status === 403)) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      window.location.replace("login.html");
    }
    throw new Error(data?.message || `La solicitud fallo (${response.status}).`);
  }

  return data;
}

function setButtonBusy(button, busy, busyText) {
  if (!button.dataset.defaultText) button.dataset.defaultText = button.textContent.trim();
  button.disabled = busy;
  button.textContent = busy ? busyText : button.dataset.defaultText;
}

async function handleLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const message = document.getElementById("form-message");
  message.hidden = true;
  setButtonBusy(button, true, "Validando acceso...");

  try {
    const formData = new FormData(form);
    const result = await apiRequest("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: formData.get("email"),
        password: formData.get("password")
      })
    });

    if (!result?.token) throw new Error("La API no devolvio un token de acceso.");
    localStorage.setItem(TOKEN_KEY, result.token);
    if (result.user) localStorage.setItem(USER_KEY, JSON.stringify(result.user));
    window.location.assign("home.html");
  } catch (error) {
    showMessage(message, error.message || "No fue posible iniciar sesion.");
    setButtonBusy(button, false);
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const message = document.getElementById("form-message");
  message.hidden = true;
  setButtonBusy(button, true, "Creando cuenta...");

  try {
    const formData = new FormData(form);
    await apiRequest("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        name: formData.get("name"),
        email: formData.get("email"),
        itsonId: formData.get("itsonId"),
        password: formData.get("password")
      })
    });
    form.reset();
    showMessage(message, "Cuenta creada. Ya puedes iniciar sesion.", true);
  } catch (error) {
    showMessage(message, error.message || "No fue posible crear la cuenta.");
  } finally {
    setButtonBusy(button, false);
  }
}

function readStoredUser() {
  const storedUser = localStorage.getItem(USER_KEY);
  if (!storedUser) return null;
  try {
    return JSON.parse(storedUser);
  } catch {
    localStorage.removeItem(USER_KEY);
    return null;
  }
}

function setHomeMessage(message, isSuccess = false) {
  showMessage(document.getElementById("home-message"), message, isSuccess);
}

function updateProjectForm(project = null) {
  const form = document.getElementById("project-form");
  const editId = document.getElementById("project-id");
  const button = document.getElementById("save-project");
  const cancelButton = document.getElementById("cancel-edit");
  editId.value = project?._id || project?.id || "";
  form.elements.title.value = project?.title || "";
  form.elements.description.value = project?.description || "";
  form.elements.repository.value = project?.repository || "";
  form.elements.technologies.value = Array.isArray(project?.technologies)
    ? project.technologies.join(", ")
    : "";
  button.innerHTML = project
    ? '<span aria-hidden="true">✧</span> Actualizar registro'
    : '<span aria-hidden="true">✧</span> Guardar en el archivo';
  cancelButton.hidden = !project;
  document.getElementById("form-heading").textContent = project
    ? "Editar proyecto"
    : "Registrar un proyecto";
}

function renderProjects(projects) {
  const list = document.getElementById("project-list");
  const template = document.getElementById("project-template");
  const emptyState = document.getElementById("empty-state");
  list.replaceChildren();
  document.getElementById("project-count").textContent = String(projects.length).padStart(2, "0");
  emptyState.hidden = projects.length > 0;

  for (const project of projects) {
    const card = template.content.firstElementChild.cloneNode(true);
    const projectId = project._id || project.id;
    card.dataset.projectId = projectId || "";
    card.querySelector(".project-title").textContent = project.title || "Proyecto sin titulo";
    card.querySelector(".project-description").textContent = project.description || "";
    const displayId = projectId ? String(projectId) : "";
    card.querySelector(".project-card-id").textContent = displayId ? `REGISTRO ${displayId.slice(-6)}` : "REGISTRO";

    const technologyList = card.querySelector(".technology-list");
    for (const technology of Array.isArray(project.technologies) ? project.technologies : []) {
      const badge = document.createElement("span");
      badge.className = "technology-badge";
      badge.textContent = technology;
      technologyList.append(badge);
    }

    const repositoryLink = card.querySelector(".repository-link");
    if (project.repository) {
      repositoryLink.href = project.repository;
      repositoryLink.hidden = false;
    }

    card.querySelector(".edit-project").addEventListener("click", () => {
      updateProjectForm(project);
      document.getElementById("new-project").scrollIntoView({ behavior: "smooth" });
      document.getElementById("project-title").focus();
    });
    card.querySelector(".delete-project").addEventListener("click", () => {
      removeProject(projectId, project.title || "este proyecto");
    });
    list.append(card);
  }
}

async function loadProjects() {
  setHomeMessage("Consultando el archivo real...");
  try {
    const result = await apiRequest("/projects", {}, true);
    const projects = Array.isArray(result) ? result : result?.projects;
    if (!Array.isArray(projects)) throw new Error("La respuesta de proyectos no tiene el formato esperado.");
    renderProjects(projects);
    document.getElementById("home-message").hidden = true;
  } catch (error) {
    if (localStorage.getItem(TOKEN_KEY)) setHomeMessage(error.message || "No fue posible cargar los proyectos.");
  }
}

async function saveProject(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.getElementById("save-project");
  const projectId = form.elements.projectId.value;
  const technologies = form.elements.technologies.value
    .split(",")
    .map((technology) => technology.trim())
    .filter(Boolean);
  const project = {
    title: form.elements.title.value.trim(),
    description: form.elements.description.value.trim(),
    technologies,
    repository: form.elements.repository.value.trim()
  };

  if (!projectId && !project.repository) delete project.repository;
  if (!projectId) {
    const user = readStoredUser();
    const userId = user?.id || user?._id;
    if (!userId) {
      setHomeMessage("No se encontro el identificador de tu cuenta. Vuelve a iniciar sesion.");
      return;
    }
    project.userId = userId;
  }

  button.disabled = true;
  try {
    await apiRequest(projectId ? `/projects/${encodeURIComponent(projectId)}` : "/projects", {
      method: projectId ? "PUT" : "POST",
      body: JSON.stringify(project)
    }, true);
    form.reset();
    updateProjectForm();
    await loadProjects();
    setHomeMessage(projectId ? "Proyecto actualizado." : "Proyecto agregado al archivo.", true);
  } catch (error) {
    setHomeMessage(error.message || "No fue posible guardar el proyecto.");
  } finally {
    button.disabled = false;
  }
}

async function removeProject(projectId, title) {
  if (!projectId) {
    setHomeMessage("Este proyecto no tiene un identificador valido.");
    return;
  }
  if (!window.confirm(`Eliminar "${title}" del archivo?`)) return;

  try {
    await apiRequest(`/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" }, true);
    setHomeMessage("Proyecto eliminado del archivo.", true);
    await loadProjects();
  } catch (error) {
    setHomeMessage(error.message || "No fue posible eliminar el proyecto.");
  }
}

function initializeHome() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    window.location.replace("login.html");
    return;
  }

  const user = readStoredUser();
  if (user?.name) document.getElementById("user-name").textContent = user.name;

  document.getElementById("project-form").addEventListener("submit", saveProject);
  document.getElementById("cancel-edit").addEventListener("click", () => {
    document.getElementById("project-form").reset();
    updateProjectForm();
  });
  document.getElementById("logout-button").addEventListener("click", () => {
    endSession();
  });
  loadProjects();
}

async function endSession() {
  let logoutError = "";
  try {
    await apiRequest("/auth/logout", { method: "POST" }, true);
  } catch (error) {
    logoutError = error.message || "No fue posible invalidar la sesion en el servidor.";
  }
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  if (logoutError) sessionStorage.setItem(LOGOUT_ERROR_KEY, logoutError);
  window.location.replace("login.html");
}

const page = document.body.dataset.page;
if (page === "login") {
  const logoutError = sessionStorage.getItem(LOGOUT_ERROR_KEY);
  if (logoutError) {
    showMessage(document.getElementById("form-message"), logoutError);
    sessionStorage.removeItem(LOGOUT_ERROR_KEY);
  }
  document.getElementById("login-form").addEventListener("submit", handleLogin);
}
if (page === "register") document.getElementById("register-form").addEventListener("submit", handleRegister);
if (page === "home") initializeHome();
if (!page) window.location.replace("login.html");
