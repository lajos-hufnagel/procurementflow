sap.ui.define(["sap/ui/core/Component", "sap/ui/core/ComponentContainer", "sap/m/MessageBox", "./DemoScenario"], function (Component, ComponentContainer, MessageBox, DemoScenario) {
  "use strict";
  let currentComponent;
  const componentName = document.body.dataset.component;
  async function navigate(url) {
    // Flush auto-saved field changes before leaving the current identity or language.
    const model = currentComponent && currentComponent.getModel();
    if (model) {
      await model.submitBatch("$auto");
      if (model.hasPendingChanges()) return false;
    }
    location.assign(url);
    return true;
  }
  async function start() {
    const lang = new URLSearchParams(location.search).get("sap-ui-language") === "en" ? "en" : "de";
    document.documentElement.lang = lang;
    if (lang === "en") {
      document.querySelector(".pf-brand").setAttribute("aria-label", "ProcurementFlow home");
      document.getElementById("nav-decisions").textContent = "Decisions";
      document.getElementById("demo-data-note").textContent = "Demo data: All companies and offers are fictional.";
      document.getElementById("demo-label").textContent = "Local demo";
      document.getElementById("user-caption").textContent = "Identity";
      document.getElementById("language-caption").textContent = "Language";
      document.getElementById("demo-user").setAttribute("aria-label", "Demo identity");
      document.getElementById("language").setAttribute("aria-label", "Language");
      ["Buyer", "Approver", "Reader", "Both roles"].forEach((label, i) => {
        const option = document.getElementById("demo-user").options[i];
        option.textContent = label + " · " + option.value;
      });
      document.getElementById("startup-message").textContent = "Loading procurement cases …";
      document.getElementById("content").setAttribute("aria-label", "Procurement cases");
    }
    for (const link of document.querySelectorAll(".pf-nav a, .pf-brand")) {
      const url = new URL(link.href);
      url.searchParams.set("sap-ui-language", lang);
      link.href = url.href;
      link.onclick = function (event) { event.preventDefault(); navigate(url.href).catch(console.error); };
    }
    const language = document.getElementById("language");
    language.value = lang;
    language.onchange = function () {
      const url = new URL(location.href);
      url.searchParams.set("sap-ui-language", language.value);
      navigate(url).catch(function (error) { console.error(error); });
    };
    const configResponse = await fetch("/app-config");
    if (!configResponse.ok) throw new Error("Configuration unavailable");
    const config = await configResponse.json();
    const headers = { "Accept-Language": lang };
    if (config.localDemo || config.publicDemo) {
      const identities = ["buyer", "approver", "reader", "dual"];
      const stored = sessionStorage.getItem("procurementflow.demoUser");
      const user = identities.includes(stored) ? stored : "buyer";
      if (config.publicDemo) {
        const response = await fetch("/demo/session", { method: "POST", headers: { "X-Demo-Bootstrap": "1" } });
        if (!response.ok) throw new Error("Demo session unavailable");
        const demo = await response.json();
        headers["X-Demo-Role"] = user;
        headers["X-Demo-CSRF"] = demo.csrfToken;
        DemoScenario.attach({ lang, csrfToken: demo.csrfToken, scenario: demo.scenario });
        document.getElementById("demo-label").textContent = lang === "en" ? "Personal demo" : "Persönliche Demo";
        document.getElementById("user-caption").textContent = lang === "en" ? "Demo role" : "Demo-Rolle";
        document.getElementById("demo-user").setAttribute("aria-label", lang === "en" ? "Demo role" : "Demo-Rolle");
        const labels = lang === "en" ? ["Buyer", "Approver", "Reader", "Dual"] : ["Einkauf", "Freigabe", "Lesen", "Dual"];
        const dualHint = lang === "en"
          ? "Demo exception: You can approve your own submissions."
          : "Demo-Ausnahme: Sie können Ihre eigenen Einreichungen freigeben.";
        const roleSelect = document.getElementById("demo-user");
        [...roleSelect.options].forEach((option, i) => {
          option.textContent = labels[i];
          option.title = option.value === "dual" ? dualHint : "";
        });
        roleSelect.title = user === "dual" ? dualHint : "";
        const reset = document.getElementById("demo-reset");
        reset.hidden = false;
        reset.textContent = lang === "en" ? "Restart demo" : "Demo neu starten";
        reset.onclick = function () {
          MessageBox.confirm(lang === "en"
            ? "Restart your demo with the twelve original cases? Your current changes will be discarded."
            : "Möchten Sie Ihre Demo mit den zwölf ursprünglichen Fällen neu starten? Ihre bisherigen Änderungen werden verworfen.", {
            title: lang === "en" ? "Restart demo" : "Demo neu starten",
            onClose: async function (action) {
              if (action !== MessageBox.Action.OK) return;
              reset.disabled = true;
              try {
                const response = await fetch("/demo/reset", { method: "POST", headers: {
                  "X-Demo-Bootstrap": "1", "X-Demo-CSRF": demo.csrfToken
                } });
                if (!response.ok) throw new Error("Reset failed");
                sessionStorage.setItem("procurementflow.demoUser", "buyer");
                location.assign("/cockpit/webapp/index.html?sap-ui-language=" + lang);
              } catch {
                reset.disabled = false;
                MessageBox.error(lang === "en" ? "Your demo could not be restarted. Please reload and try again."
                  : "Ihre Demo konnte nicht neu gestartet werden. Bitte laden Sie die Seite neu und versuchen Sie es erneut.");
              }
            }
          });
        };
      } else {
        headers.Authorization = "Basic " + btoa(user + ":demo-" + user);
      }
      const select = document.getElementById("demo-user");
      select.value = user;
      select.onchange = async function () {
        const url = new URL(location.href);
        url.hash = url.hash.replace("IsActiveEntity=false", "IsActiveEntity=true");
        const model = currentComponent && currentComponent.getModel();
        if (model) {
          await model.submitBatch("$auto");
          if (model.hasPendingChanges()) { select.value = user; return; }
        }
        sessionStorage.setItem("procurementflow.demoUser", select.value);
        history.replaceState(null, "", url);
        location.reload();
      };
      document.getElementById("demo-label").hidden = false;
      document.getElementById("user-label").hidden = false;
    }
    const sessionResponse = await fetch("/procurement/session()", { headers });
    if (!sessionResponse.ok) throw new Error("Session unavailable");
    const session = await sessionResponse.json();
    const manifest = await (await fetch("manifest.json")).json();
    manifest["sap.ui5"].models[""].settings.httpHeaders = headers;
    const component = await Component.create({ name: componentName, manifest, componentData: { session } });
    currentComponent = component;
    document.getElementById("startup-message").remove();
    new ComponentContainer({ component, height: "100%", width: "100%" }).placeAt("content");
  }
  start().catch(function (error) {
    console.error("Application startup failed", error);
    const node = document.getElementById("startup-message");
    if (node) node.textContent = document.documentElement.lang === "en" ? "The application could not be loaded. Check the connection and reload." : "Die Anwendung konnte nicht geladen werden. Bitte Verbindung prüfen und neu laden.";
  });
});
