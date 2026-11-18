sap.ui.define(["sap/fe/core/AppComponent", "sap/ui/model/json/JSONModel"], function (AppComponent, JSONModel) {
  "use strict";
  return AppComponent.extend("procurementflow.decisions.Component", {
    metadata: { manifest: "json" },
    init: function () {
      this.setModel(new JSONModel(this.getComponentData().session), "session");
      AppComponent.prototype.init.apply(this, arguments);
    }
  });
});
