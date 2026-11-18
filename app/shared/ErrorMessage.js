sap.ui.define(["sap/base/i18n/Localization"], function (Localization) {
  "use strict";
  function readable(value) {
    if (typeof value !== "string") return "";
    const text = value.trim();
    return !text || /\[object [^\]]+\]/.test(text) || /^(undefined|null|\{\}|\[\])$/.test(text) ? "" : text;
  }
  function text(error, fallback) {
    const seen = new Set();
    function extract(value) {
      if (typeof value === "string") return readable(value);
      if (!value || typeof value !== "object" || seen.has(value)) return "";
      seen.add(value);
      if (Array.isArray(value)) return [...new Set(value.map(extract).filter(Boolean))].join("\n");
      if (value.status === "fulfilled") return "";
      // Native errors, OData messages and rejected results use different envelopes.
      const message = readable(value.message) || readable(value.message && value.message.value);
      if (message) return message;
      for (const key of ["error", "reason", "cause", "responseJSON", "details"]) {
        const nested = extract(value[key]);
        if (nested) return nested;
      }
      if (typeof value.responseText === "string") {
        try { return extract(JSON.parse(value.responseText)); } catch (_) { /* Not an OData response. */ }
      }
      return "";
    }
    return extract(error) || readable(fallback) || (Localization.getLanguage().toLowerCase().startsWith("de")
      ? "Die Aktion konnte nicht abgeschlossen werden. Bitte aktualisieren und den Stand prüfen."
      : "The action could not be completed. Refresh and check the current state.");
  }
  function isReportedActionError(error) {
    // EditFlow presents the backend messages before rejecting with settled action results.
    return Array.isArray(error) && error.length > 0
      && error.every(result => result && (result.status === "fulfilled" || result.status === "rejected"))
      && error.some(result => result.status === "rejected");
  }
  return { text, isReportedActionError };
});
