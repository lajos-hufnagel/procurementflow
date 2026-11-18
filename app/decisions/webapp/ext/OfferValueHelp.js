sap.ui.define([], function () {
  "use strict";
  const registered = new WeakSet();
  const configured = new WeakSet();
  const widths = {
    "supplier/name": "auto",
    deliveryDate: "9rem",
    unitPrice: "10rem",
    shipping: "10rem",
    validUntil: "9rem"
  };

  function onOpened(event) {
    const container = event.getParameter("container");
    if (!container?.isA("sap.ui.mdc.valuehelp.Dialog")) return;
    for (const content of container.getContent()) {
      if (!content.isA("sap.ui.mdc.valuehelp.content.MDCTable")) continue;
      const table = content.getTable();
      // Keep the responsive phone layout and any widths subsequently chosen by the user.
      if (!table?.getType()?.isA("sap.ui.mdc.table.GridTableType") || configured.has(table)) continue;
      for (const column of table.getColumns()) {
        const width = widths[column.getPropertyKey()];
        if (!width) continue;
        // The generated value-help table does not use the page's manifest column settings.
        column.unbindProperty("width");
        column.setWidth(width);
      }
      configured.add(table);
    }
  }

  return {
    attach: function (view) {
      const valueHelp = view.byId("FieldValueHelp::DecisionWorkspaces::selectedOffer_ID");
      if (!valueHelp || registered.has(valueHelp)) return;
      valueHelp.attachOpened(onOpened);
      registered.add(valueHelp);
    }
  };
});
