const form = document.querySelector("#rsvp-form");
const feedback = document.querySelector("#form-feedback");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitter = event.submitter;
  const payload = {
    name: form.elements.name.value,
    message: form.elements.message.value,
    answer: submitter ? submitter.value : "yes",
  };
  const buttons = form.querySelectorAll("button");
  buttons.forEach((button) => { button.disabled = true; });
  feedback.textContent = "Enviando sua resposta…";

  try {
    const response = await fetch("/api/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Não foi possível enviar sua resposta.");
    form.reset();
    feedback.textContent = result.message;
  } catch (error) {
    feedback.textContent = error.message || "Não foi possível enviar sua resposta. Tente novamente.";
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
});