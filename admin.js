const loginView = document.querySelector("#login-view");
const responsesView = document.querySelector("#responses-view");
const loginForm = document.querySelector("#login-form");
const loginFeedback = document.querySelector("#login-feedback");
const responsesFeedback = document.querySelector("#responses-feedback");
const responseList = document.querySelector("#response-list");
const responseCount = document.querySelector("#response-count");

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = loginForm.querySelector("button");
  button.disabled = true;
  loginFeedback.textContent = "";

  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: loginForm.elements.password.value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Não foi possível entrar.");
    loginForm.reset();
    await showResponses();
  } catch (error) {
    loginFeedback.textContent = error.message || "Não foi possível entrar. Tente novamente.";
  } finally {
    button.disabled = false;
  }
});

async function showResponses() {
  const response = await fetch("/api/admin/responses", { cache: "no-store" });
  if (response.status === 401) return;
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Não foi possível carregar as respostas.");

  loginView.hidden = true;
  responsesView.hidden = false;
  responseCount.textContent = `${result.length} ${result.length === 1 ? "resposta recebida" : "respostas recebidas"}.`;
  responseList.replaceChildren();

  if (result.length === 0) {
    const empty = document.createElement("li");
    empty.className = "response-empty";
    empty.textContent = "Ainda não chegaram respostas.";
    responseList.append(empty);
    return;
  }

  for (const item of [...result].reverse()) {
    const entry = document.createElement("li");
    entry.className = "response-item";
    const heading = document.createElement("h2");
    heading.textContent = `${item.name} — ${item.answer === "yes" ? "aceitou o convite" : "não poderá ir"}`;
    const message = document.createElement("p");
    message.textContent = item.message || "Sem mensagem adicional.";
    const date = document.createElement("time");
    date.dateTime = item.createdAt;
    date.textContent = new Date(item.createdAt).toLocaleString("pt-BR");
    entry.append(heading, message, date);
    responseList.append(entry);
  }
}

document.querySelector("#logout-button").addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  responsesView.hidden = true;
  loginView.hidden = false;
});

showResponses().catch((error) => {
  responsesFeedback.textContent = error.message || "Não foi possível carregar as respostas.";
});
