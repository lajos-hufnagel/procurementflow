sap.ui.define(["sap/m/MessageBox"], function (MessageBox) {
  "use strict";
  function attach(options) {
    const en = options.lang === "en";
    const select = document.getElementById("demo-scenario");
    const note = document.getElementById("demo-scenario-note");
    const stop = document.getElementById("demo-scenario-stop");
    let current = options.scenario;
    let changing = false;
    let revision = 0;
    const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("procurementflow.demo-scenario") : null;
    const headers = { "Accept-Language": options.lang, "X-Demo-CSRF": options.csrfToken, "Content-Type": "application/json" };
    document.getElementById("scenario-caption").textContent = en ? "Demo scenario" : "Demo-Szenario";
    select.setAttribute("aria-label", en ? "Demo scenario" : "Demo-Szenario");
    select.title = en ? "Applies only to your personal demo." : "Gilt nur für Ihre persönliche Demo.";
    select.options[0].textContent = en ? "Normal operation" : "Normalbetrieb";
    select.options[1].textContent = en ? "Simulate ERP outage" : "ERP-Ausfall simulieren";
    document.getElementById("demo-scenario-message").textContent = en
      ? "Demo simulation: ERP unavailable. Only your demo is affected."
      : "Demo-Simulation: ERP nicht erreichbar. Nur Ihre Demo ist betroffen.";
    stop.textContent = en ? "End simulation" : "Simulation beenden";
    function render(value, force = true) {
      if (!["normal", "erp-outage"].includes(value)) throw new Error("Invalid demo scenario");
      // A focus refresh must not overwrite an uncommitted native keyboard selection.
      if (force || value !== current || document.activeElement !== select) select.value = value;
      current = value;
      note.hidden = value !== "erp-outage";
    }
    async function request(method, scenario) {
      const response = await fetch("/demo/scenario", { method, headers, cache: "no-store",
        body: method === "POST" ? JSON.stringify({ scenario }) : undefined });
      if (!response.ok) throw new Error("Demo scenario request failed");
      return (await response.json()).scenario;
    }
    async function refresh() {
      if (changing) return;
      const version = ++revision;
      try {
        const value = await request("GET");
        if (version !== revision) return;
        render(value, false);
        select.disabled = stop.disabled = false;
      } catch { /* Keep the last confirmed state; a failed write explains how to reload. */ }
    }
    async function change(value) {
      if (changing) return;
      changing = true;
      ++revision;
      select.disabled = stop.disabled = true;
      let confirmed = true;
      try {
        render(await request("POST", value));
        if (channel) channel.postMessage("changed");
      } catch {
        // A lost response might follow a successful save. Read back the server state before showing it.
        try { render(await request("GET")); } catch { confirmed = false; render(current); }
        MessageBox.error(en
          ? "The demo scenario could not be confirmed. Please reload the page and try again."
          : "Das Demo-Szenario konnte nicht bestätigt werden. Bitte laden Sie die Seite neu und versuchen Sie es erneut.");
      } finally {
        changing = false;
        select.disabled = stop.disabled = !confirmed;
      }
    }
    render(current);
    select.onchange = function () { change(select.value); };
    stop.onclick = function () { change("normal"); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
    if (channel) channel.onmessage = refresh;
    window.addEventListener("pageshow", refresh);
    window.addEventListener("pagehide", function (event) { if (channel && !event.persisted) channel.close(); });
    document.getElementById("scenario-label").hidden = false;
  }
  return { attach };
});
