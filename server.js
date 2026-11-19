const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "Public");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const RESPONSES_FILE = path.join(DATA_DIR, "responses.json");
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function loadLocalEnv() {
  const envFile = path.join(ROOT, ".env");
  let contents;

  try {
    contents = require("node:fs").readFileSync(envFile, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
}

loadLocalEnv();

if (!process.env.ADMIN_PASSWORD) {
  throw new Error("Defina ADMIN_PASSWORD no arquivo .env antes de iniciar o servidor.");
}

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const adminSalt = crypto.randomBytes(16);
const adminPasswordHash = crypto.scryptSync(process.env.ADMIN_PASSWORD, adminSalt, 64);
const sessions = new Map();
const loginAttempts = new Map();
const app = express();
let writeQueue = Promise.resolve();

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'",
  });
  next();
});
app.use(express.json({ limit: "10kb" }));
app.use(express.static(PUBLIC_DIR, { dotfiles: "deny", index: "index.html" }));

function getSessionId(req) {
  const cookie = req.headers.cookie || "";
  const pair = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("admin_session="));
  return pair ? pair.slice("admin_session=".length) : "";
}

function requireAdmin(req, res, next) {
  const sessionId = getSessionId(req);
  const expiresAt = sessions.get(sessionId);

  if (!expiresAt || expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return res.status(401).json({ error: "Faça login para continuar." });
  }

  res.set("Cache-Control", "no-store");
  next();
}

app.post("/api/responses", async (req, res, next) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const answer = body.answer;
  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (name.length < 2 || name.length > 80) {
    return res.status(400).json({ error: "Informe um nome entre 2 e 80 caracteres." });
  }
  if (answer !== "yes" && answer !== "no") {
    return res.status(400).json({ error: "Escolha uma das opções de resposta." });
  }
  if (message.length > 500) {
    return res.status(400).json({ error: "A mensagem pode ter no máximo 500 caracteres." });
  }

  const response = {
    id: crypto.randomUUID(),
    name,
    answer,
    message,
    createdAt: new Date().toISOString(),
  };

  try {
    await queueResponseWrite(async () => {
      let responses = [];
      try {
        responses = JSON.parse(await fs.readFile(RESPONSES_FILE, "utf8"));
        if (!Array.isArray(responses)) throw new Error("O arquivo de respostas tem formato inválido.");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }

      responses.push(response);
      await fs.mkdir(DATA_DIR, { recursive: true });
      const temporaryFile = `${RESPONSES_FILE}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temporaryFile, JSON.stringify(responses, null, 2), "utf8");
      await fs.rename(temporaryFile, RESPONSES_FILE);
    });
    res.status(201).json({ message: "Resposta recebida. Obrigado!" });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/login", (req, res) => {
  const now = Date.now();
  const address = req.ip;
  const attempts = loginAttempts.get(address);

  if (attempts && attempts.resetAt > now && attempts.count >= 5) {
    return res.status(429).json({ error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const password = typeof body.password === "string" ? body.password : "";
  const passwordHash = crypto.scryptSync(password, adminSalt, 64);
  const valid = crypto.timingSafeEqual(passwordHash, adminPasswordHash);

  if (!valid) {
    const current = attempts && attempts.resetAt > now ? attempts : { count: 0, resetAt: now + 15 * 60 * 1000 };
    current.count += 1;
    loginAttempts.set(address, current);
    return res.status(401).json({ error: "Senha incorreta." });
  }

  loginAttempts.delete(address);
  const sessionId = crypto.randomBytes(32).toString("base64url");
  sessions.set(sessionId, now + SESSION_TTL_MS);
  res.cookie("admin_session", sessionId, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
  res.set("Cache-Control", "no-store");
  res.json({ message: "Login realizado." });
});

app.post("/api/admin/logout", requireAdmin, (req, res) => {
  sessions.delete(getSessionId(req));
  res.clearCookie("admin_session", { httpOnly: true, sameSite: "strict", path: "/" });
  res.status(204).end();
});

app.get("/api/admin/responses", requireAdmin, async (req, res, next) => {
  try {
    let responses = [];
    try {
      responses = JSON.parse(await fs.readFile(RESPONSES_FILE, "utf8"));
      if (!Array.isArray(responses)) throw new Error("O arquivo de respostas tem formato inválido.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    res.set("Cache-Control", "no-store");
    res.json(responses);
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error("Erro ao processar solicitação:", error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: "Não foi possível concluir a solicitação. Tente novamente." });
});

function queueResponseWrite(operation) {
  const result = writeQueue.then(operation);
  writeQueue = result.catch(() => {});
  return result;
}

app.listen(PORT, HOST, () => {
  console.log(`Convite disponível em http://${HOST}:${PORT}`);
});