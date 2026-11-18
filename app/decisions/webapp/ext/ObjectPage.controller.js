sap.ui.define(["sap/ui/core/mvc/ControllerExtension", "./Actions", "./OfferValueHelp", "./History"], function (ControllerExtension, Actions, OfferValueHelp, History) {
  "use strict";
  return ControllerExtension.extend("procurementflow.decisions.ext.ObjectPage", {
    override: {
      onAfterRendering: function () {
        OfferValueHelp.attach(this.base.getView());
        History.attach(this.base.getView());
      },
      routing: {
        onBeforeBinding: function (context) { History.bind(this.base.getView(), context, true); },
        onAfterBinding: function (context) {
          const view = this.base.getView();
          History.bind(view, context);
          return Actions.bind(context, this.base.getExtensionAPI(), view.getModel("i18n"), function () { return History.refresh(view); });
        }
      },
      onExit: function () {
        History.release(this.base.getView());
        Actions.release(this.base.getView().getModel());
      }
    }
  });
});
