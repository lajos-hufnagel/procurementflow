sap.ui.define([], function () {
  "use strict";
  const pages = new WeakMap();
  const tableID = "fe::table::procurementCase::history::LineItem";

  function attach(view) {
    const entry = pages.get(view);
    const table = view.byId(tableID);
    if (!entry || !table || entry.table === table) return;
    // History describes the saved case. Its requests must survive activation or discard
    // of the editing workspace, including requests already in flight at that point.
    table.bindObject({ path: entry.path, parameters: { $select: "ID,IsActiveEntity" } });
    entry.table = table;
  }

  function release(view) {
    const entry = pages.get(view);
    if (entry && entry.table) entry.table.unbindObject();
    pages.delete(view);
  }

  return {
    attach, release,
    bind: function (view, context, renew) {
      if (!context) { release(view); return; }
      // Object-page contexts use the canonical DecisionWorkspaces key predicate.
      const path = context.getPath().replace(/IsActiveEntity=false(?=[,)])/, "IsActiveEntity=true");
      // Reopening a cached page must read changes made through another interface.
      if (renew || pages.get(view)?.path !== path) {
        release(view);
        pages.set(view, { path });
      }
      attach(view);
    },
    refresh: function (view) {
      const context = pages.get(view)?.table?.getObjectBinding()?.getBoundContext();
      return context ? context.requestRefresh() : Promise.resolve();
    }
  };
});
