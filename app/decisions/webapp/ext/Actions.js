sap.ui.define(["sap/m/Dialog", "sap/m/Button", "sap/m/TextArea", "sap/m/Label", "sap/m/VBox", "sap/m/MessageToast", "sap/m/MessageBox", "sap/ui/core/message/Message", "sap/ui/core/library", "procurementflow/shared/ErrorMessage"], function (Dialog, Button, TextArea, Label, VBox, MessageToast, MessageBox, Message, coreLibrary, ErrorMessage) {
  "use strict";
  const pages = new WeakMap();
  function release(model) {
    const entry = pages.get(model);
    if (entry && entry.binding) entry.binding.destroy();
    pages.delete(model);
  }
  function bind(context, api, resourceModel, refreshRelated) {
    const model = context.getModel();
    release(model);
    const entry = { api, context, refreshRelated, ready: null, binding: null };
    pages.set(model, entry);
    entry.ready = (async function () {
      entry.texts = await resourceModel.getResourceBundle();
      const id = await context.requestProperty("ID");
      if (pages.get(model) !== entry) return;
      entry.binding = model.bindContext("/Cases(" + id + ")");
      const values = await entry.binding.requestObject();
      if (pages.get(model) !== entry) return;
      entry.version = values.version;
      const isDraft = await context.requestProperty("IsActiveEntity") === false;
      api.showMessages(isDraft ? [new Message({ message: entry.texts.getText("draftCostHint"), type: coreLibrary.MessageType.Information })] : []);
    })().catch(function (error) {
      // Navigation may cancel an earlier binding. Only the current page reports a real load failure.
      if (pages.get(model) !== entry) return;
      entry.loadError = true;
      MessageBox.error(ErrorMessage.text(error, entry.texts && entry.texts.getText("loadFailed")));
    });
    return entry.ready;
  }
  function rejectionReason(texts) {
    return new Promise(function (resolve) {
      let answer;
      const area = new TextArea({ width: "100%", rows: 5, maxLength: 2000, valueStateText: texts.getText("declineRequired") });
      const label = new Label({ text: texts.getText("declineReason"), labelFor: area, required: true });
      const dialog = new Dialog({
        title: texts.getText("declineTitle"), contentWidth: "28rem", initialFocus: area,
        content: new VBox({ items: [label, area] }).addStyleClass("sapUiMediumMargin"),
        beginButton: new Button({ text: texts.getText("decline"), type: "Emphasized", press: function () {
          if (!area.getValue().trim()) { area.setValueState("Error"); return; }
          answer = area.getValue().trim(); dialog.close();
        } }),
        endButton: new Button({ text: texts.getText("cancel"), press: function () { dialog.close(); } }),
        afterClose: function () { dialog.destroy(); resolve(answer); }
      });
      dialog.open();
    });
  }
  function serial(context, operation) {
    const model = context.getModel();
    const entry = pages.get(model);
    if (!entry) return Promise.resolve();
    // A following action must wait for the successful action's complete refresh,
    // including its viewed version. Do not fetch a new version before each write.
    const pending = (entry.pending || Promise.resolve()).then(function () {
      if (pages.get(model) !== entry) return;
      return operation();
    });
    entry.pending = pending.catch(function () {});
    return pending;
  }
  async function invoke(context, action) {
    const entry = pages.get(context.getModel());
    if (!entry) return;
    await entry.ready;
    if (entry.loadError || pages.get(context.getModel()) !== entry) return;
    const parameters = [{ name: "expectedVersion", value: entry.version }];
    if (action === "decline") {
      const reason = await rejectionReason(entry.texts);
      if (reason === undefined) return;
      parameters.push({ name: "reason", value: reason });
    }
    try {
      await entry.api.getEditFlow().invokeAction("ProcurementService." + action, {
        contexts: entry.binding.getBoundContext(), parameterValues: parameters,
        skipParameterDialog: true, label: entry.texts.getText(action)
      });
    } catch (error) {
      // Backend messages have already been shown by EditFlow. Do not display them a second time.
      // Preserve the viewed version and never retry an action silently.
      if (pages.get(context.getModel()) === entry && !ErrorMessage.isReportedActionError(error)) {
        MessageBox.error(ErrorMessage.text(error, entry.texts.getText("actionFailed")));
      }
      return;
    }
    try {
      await entry.api.refresh();
      await entry.binding.getBoundContext().requestRefresh();
      if (pages.get(context.getModel()) !== entry) return;
      entry.version = (await entry.binding.requestObject()).version;
      if (entry.refreshRelated) await entry.refreshRelated();
      if (pages.get(context.getModel()) !== entry) return;
      MessageToast.show(entry.texts.getText("actionComplete"));
    } catch (error) {
      // The write succeeded; a failed refresh must not suggest repeating the business action.
      if (pages.get(context.getModel()) === entry) {
        MessageBox.error(entry.texts.getText("actionRefreshFailed") + "\n\n" + ErrorMessage.text(error, entry.texts.getText("loadFailed")));
      }
    }
  }
  return {
    bind, release,
    refresh: function (context) {
      return serial(context, async function () {
        const entry = pages.get(context.getModel());
        if (!entry) return;
        await entry.ready;
        if (entry.loadError || pages.get(context.getModel()) !== entry) return;
        try {
          await entry.api.refresh();
          await entry.binding.getBoundContext().requestRefresh();
          if (pages.get(context.getModel()) !== entry) return;
          entry.version = (await entry.binding.requestObject()).version;
          if (entry.refreshRelated) await entry.refreshRelated();
        } catch (error) {
          if (pages.get(context.getModel()) === entry) MessageBox.error(ErrorMessage.text(error, entry.texts.getText("loadFailed")));
        }
      });
    },
    retryTransfer: function (context) { return serial(context, function () { return invoke(context, "retryTransfer"); }); },
    submit: function (context) { return serial(context, function () { return invoke(context, "submit"); }); },
    withdraw: function (context) { return serial(context, function () { return invoke(context, "withdraw"); }); },
    reopen: function (context) { return serial(context, function () { return invoke(context, "reopen"); }); },
    approve: function (context) { return serial(context, function () { return invoke(context, "approve"); }); },
    decline: function (context) { return serial(context, function () { return invoke(context, "decline"); }); }
  };
});
