import Controller from "sap/ui/core/mvc/Controller";
import UIComponent from "sap/ui/core/UIComponent";
import JSONModel from "sap/ui/model/json/JSONModel";
import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import type ODataContextBinding from "sap/ui/model/odata/v4/ODataContextBinding";
import type ODataListBinding from "sap/ui/model/odata/v4/ODataListBinding";
import ResourceModel from "sap/ui/model/resource/ResourceModel";
import type ResourceBundle from "sap/base/i18n/ResourceBundle";
import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";
import Sorter from "sap/ui/model/Sorter";
import type Event from "sap/ui/base/Event";
import type Control from "sap/ui/core/Control";
import type Table from "sap/m/Table";
import type PlanningCalendar from "sap/m/PlanningCalendar";
import type { ListBase$ItemPressEvent } from "sap/m/ListBase";
import type Select from "sap/m/Select";
import type SearchField from "sap/m/SearchField";
import type Dialog from "sap/m/Dialog";
import type ViewSettingsDialog from "sap/m/ViewSettingsDialog";
import type { ViewSettingsDialog$ConfirmEvent } from "sap/m/ViewSettingsDialog";
import MessageBox from "sap/m/MessageBox";
import ErrorMessage from "procurementflow/shared/ErrorMessage";
import { searchQuery } from "../model/search";
import formatter, { calendarDate } from "../model/formatter";
import type { ComparedOffer, Comparison, ProcurementCase, Session, Summary } from "../model/types";

const CASE_SORTS = {
  caseNumber: { path: "caseNumber", label: "caseNumber" },
  material: { path: "demand/material/name", label: "material" },
  requiredOn: { path: "demand/requiredOn", label: "requiredOn" },
  referenceDelivery: { path: "referenceDeliveryDate", label: "referenceDelivery" },
  quantity: { path: "demand/quantity", label: "quantity" },
  location: { path: "demand/location", label: "location" },
  status: { path: "statusInfo/name", label: "status" },
  selectedSupplier: { path: "selectedOffer/supplier/name", label: "selectedSupplier" }
} as const;
type CaseSortKey = keyof typeof CASE_SORTS;
interface CaseSort { key: CaseSortKey; descending: boolean; explicit: boolean; }

/** @namespace procurementflow.cockpit.controller */
export default class Main extends Controller {
  formatter = formatter;
  declare private ui: JSONModel;
  declare private odata: ODataModel;
  declare private bundle: ResourceBundle;
  declare private session: Session;
  declare private selectedBinding: ODataContextBinding | undefined;
  declare private dialog: Dialog | undefined;
  declare private sortDialog: Promise<ViewSettingsDialog> | undefined;
  declare private selectionSerial: number;
  declare private onHash: () => void;

  onInit(): void {
    this.selectionSerial = 0;
    this.ui = new JSONModel({ busy: true, error: "", summary: {}, selected: null,
      comparison: { offers: [] }, canPrepare: false, selectionBusy: false, saving: false, calendarRows: [],
      sort: { key: "caseNumber", descending: false, explicit: false },
      filter: "all", draft: { offer: null, reason: "", extraCostReason: "" } });
    this.getView()!.setModel(this.ui, "ui");
    const component = this.getOwnerComponent() as UIComponent;
    this.odata = component.getModel() as ODataModel;
    this.session = (component.getComponentData() as { session: Session }).session;
    this.ui.setProperty("/evaluationDate", this.session.evaluationDate);
    this.onHash = () => { void this.loadSelected(true); };
    window.addEventListener("hashchange", this.onHash);
    void this.initialize().catch(error => {
      this.ui.setProperty("/busy", false);
      this.ui.setProperty("/error", this.message(error));
    });
  }

  private async initialize(): Promise<void> {
    this.bundle = await ((this.getOwnerComponent() as UIComponent).getModel("i18n") as ResourceModel).getResourceBundle();
    this.ui.updateBindings(true);
    await this.refresh();
  }
  private t(key: string, args?: string[]): string { return this.bundle.getText(key, args) ?? key; }
  private message(error: unknown, fallback = "requestFailed"): string { return ErrorMessage.text(error, this.bundle?.getText(fallback)); }
  private table(): Table { return this.byId("cases") as Table; }

  async refresh(): Promise<void> {
    this.ui.setProperty("/busy", true);
    this.ui.setProperty("/error", "");
    try {
      const binding = this.odata.bindContext("/cockpitSummary(...)");
      try {
        await binding.invoke("$direct");
        this.ui.setProperty("/summary", binding.getBoundContext()!.getObject() as Summary);
      } finally { binding.destroy(); }
      this.filterCases();
      await this.loadSelected();
    } catch (error) { this.ui.setProperty("/error", this.message(error)); }
    finally { this.ui.setProperty("/busy", false); }
  }

  onSearch(): void { this.filterCases(); }
  onFilter(): void { this.filterCases(); }
  onTile(event: Event): void {
    const key = (event.getSource() as Control).data("filter") as string;
    (this.byId("statusFilter") as Select).setSelectedKey(key);
    this.filterCases();
  }
  async onSortCases(): Promise<void> {
    try {
      this.sortDialog ??= this.loadFragment({ name: "procurementflow.cockpit.view.SortCases" })
        .then(control => control as ViewSettingsDialog);
      const dialog = await this.sortDialog;
      const sort = this.ui.getProperty("/sort") as CaseSort;
      dialog.setSelectedSortItem(sort.key);
      dialog.setSortDescending(sort.descending);
      dialog.open();
    } catch (error) {
      this.sortDialog = undefined;
      MessageBox.error(this.message(error));
    }
  }
  onSortCasesConfirm(event: ViewSettingsDialog$ConfirmEvent): void {
    const key = event.getParameter("sortItem")?.getKey();
    if (!key || !Object.hasOwn(CASE_SORTS, key)) return;
    this.ui.setProperty("/sort", {
      key, descending: Boolean(event.getParameter("sortDescending")), explicit: true
    });
    this.filterCases();
  }
  sortDescription(key: CaseSortKey, descending: boolean): string {
    if (!this.bundle || !CASE_SORTS[key]) return "";
    return this.t("sortDescription", [this.t(CASE_SORTS[key].label), this.t(descending ? "sortDescending" : "sortAscending")]);
  }
  private filterCases(): void {
    const key = (this.byId("statusFilter") as Select).getSelectedKey();
    const query = (this.byId("search") as SearchField).getValue().trim();
    const filters: Filter[] = [];
    if (key === "urgent") {
      filters.push(new Filter({ filters: ["Open", "Submitted", "Rejected"].map(s => new Filter("status", FilterOperator.EQ, s)), and: false }));
      filters.push(new Filter("demand/requiredOn", FilterOperator.LE, this.ui.getProperty("/summary/urgentUntil")));
    } else if (key !== "all") filters.push(new Filter("status", FilterOperator.EQ, key));
    const sort = this.ui.getProperty("/sort") as CaseSort;
    // Keep the existing urgency default until the user explicitly chooses a sort order.
    const sortKey = sort.explicit ? sort.key : key === "urgent" ? "requiredOn" : "caseNumber";
    this.ui.setProperty("/sort/key", sortKey);
    const sorters = [new Sorter(CASE_SORTS[sortKey].path, sort.descending)];
    // A unique secondary order keeps equal dates, statuses and suppliers stable across pages.
    if (sortKey !== "caseNumber") sorters.push(new Sorter("caseNumber"));
    const binding = this.table().getBinding("items") as ODataListBinding;
    binding.changeParameters({ $search: searchQuery(query) });
    binding.filter(filters);
    binding.sort(sorters);
    binding.refresh();
  }
  onListData(event: Event<{ error?: Error }>): void {
    const error = event.getParameter("error");
    if (error) this.ui.setProperty("/error", this.message(error));
  }
  onCase(event: ListBase$ItemPressEvent): void {
    const item = event.getParameter("listItem")!;
    const id = item.getBindingContext()!.getProperty("ID") as string;
    if (location.hash === `#case/${id}`) void this.loadSelected(true);
    else location.hash = `case/${id}`;
  }

  private async loadSelected(reveal = false): Promise<void> {
    const serial = ++this.selectionSerial;
    const match = /^#case\/([a-f0-9-]{36})$/i.exec(location.hash);
    let id = match?.[1];
    this.ui.setProperty("/selectionBusy", true);
    this.ui.setProperty("/canPrepare", false);
    let binding: ODataContextBinding | undefined;
    let operation: ODataContextBinding | undefined;
    try {
      if (!id) {
        // Resolve the lowest case number across all cases, independently of table paging and filters.
        const defaultCase = this.odata.bindList("/Cases", undefined, new Sorter("caseNumber"), undefined, {
          $select: "ID", $$groupId: "$direct"
        });
        try {
          const [context] = await defaultCase.requestContexts(0, 1);
          id = context?.getProperty("ID") as string | undefined;
        } finally { defaultCase.destroy(); }
        if (serial !== this.selectionSerial) return;
        if (!id) {
          this.selectedBinding?.destroy();
          this.selectedBinding = undefined;
          this.ui.setProperty("/selected", null);
          this.ui.setProperty("/comparison", { offers: [] });
          this.ui.setProperty("/calendarRows", []);
          return;
        }
      }
      binding = this.odata.bindContext(`/Cases(${id})`, undefined, {
        $select: "ID,caseNumber,title,status,version,referenceTotal,referenceCurrency,referenceDeliveryDate,reason,extraCostReason,selectedOffer_ID,orderNumber,orderedAt",
        $expand: "demand($expand=material),statusInfo,transfer($expand=statusInfo,errorInfo)"
      });
      operation = this.odata.bindContext("ProcurementService.compareOffers(...)", binding.getBoundContext());
      const selected = await binding.requestObject() as ProcurementCase;
      await operation.invoke("$direct");
      const comparison = operation.getBoundContext()!.getObject() as Comparison;
      if (serial !== this.selectionSerial) { binding.destroy(); return; }
      if (comparison.caseVersion !== selected.version) throw new Error(this.t("staleView"));
      this.selectedBinding?.destroy();
      this.selectedBinding = binding;
      this.ui.setProperty("/selected", selected);
      this.ui.setProperty("/comparison", comparison);
      this.ui.setProperty("/canPrepare", this.session.roles.includes("Buyer") && selected.status === "Open");
      (this.byId("schedule") as PlanningCalendar).setViewKey("TwoWeeks");
      const calendarStart = calendarDate(selected.demand.requiredOn);
      calendarStart.setDate(calendarStart.getDate() - 3);
      this.ui.setProperty("/calendarStart", calendarStart);
      this.ui.setProperty("/calendarRows", [
        { title: this.t("demand"), text: selected.demand.location, appointments: [{ start: calendarDate(comparison.requiredOn, 0), end: calendarDate(comparison.requiredOn, 24), title: formatter.shortDate(comparison.requiredOn), tooltip: this.t("requiredOn") + " " + formatter.date(comparison.requiredOn), type: "Type03" }] },
        ...comparison.offers.map(offer => ({ title: offer.supplierName, text: offer.isReference ? this.t("reference") : this.t("offer"),
          appointments: [{ start: calendarDate(offer.deliveryDate, 0), end: calendarDate(offer.deliveryDate, 24),
            title: formatter.shortDate(offer.deliveryDate), tooltip: this.t("offeredDelivery") + " " + formatter.date(offer.deliveryDate), type: offer.available && offer.delayDays === 0 ? "Type08" : "Type01" }] }))
      ]);
      if (reveal) this.byId("comparisonSection")?.getDomRef()?.scrollIntoView({ block: "start" });
    } catch (error) {
      binding?.destroy();
      if (serial === this.selectionSerial) {
        this.ui.setProperty("/selected", null);
        this.ui.setProperty("/error", this.message(error));
      }
    } finally {
      operation?.destroy();
      if (serial === this.selectionSerial) this.ui.setProperty("/selectionBusy", false);
    }
  }

  evaluationLabel(label: string, value?: string): string { return `${label} ${formatter.date(value)}`; }
  urgentLabel(label: string, value?: string): string { return `${label} ${formatter.date(value)}`; }

  deliveryText(delay: number | null, available: boolean, code: string | null): string {
    if (!this.bundle) return "";
    return !available ? this.t(code === "OFFER_EXPIRED" ? "expired" : "unavailable") : delay === 0 ? this.t("onTime") : this.t("late", [String(delay)]);
  }
  deliveryState(delay: number | null, available: boolean): string { return !available ? "Error" : delay === 0 ? "Success" : "Warning"; }

  async onChoose(event: Event): Promise<void> {
    const offer = (event.getSource() as Control).getBindingContext("ui")!.getObject() as ComparedOffer;
    if (!offer.available || !this.ui.getProperty("/canPrepare")) return;
    const selected = this.ui.getProperty("/selected") as ProcurementCase;
    this.ui.setProperty("/draft", { offer, reason: selected.reason ?? "", extraCostReason: selected.extraCostReason ?? "" });
    try {
      if (!this.dialog) this.dialog = await this.loadFragment({ name: "procurementflow.cockpit.view.Prepare" }) as Dialog;
      this.dialog.open();
    } catch (error) { MessageBox.error(this.message(error)); }
  }
  onCancel(): void { if (!this.ui.getProperty("/saving")) this.dialog?.close(); }
  async onSave(): Promise<void> {
    if (this.ui.getProperty("/saving") || !this.ui.getProperty("/canPrepare")) return;
    const { offer, reason, extraCostReason } = this.ui.getProperty("/draft") as { offer: ComparedOffer; reason: string; extraCostReason: string };
    if (!reason.trim() || (offer.needsExtraReason && !extraCostReason.trim())) { MessageBox.error(this.t("explainFirst")); return; }
    const comparison = this.ui.getProperty("/comparison") as Comparison;
    const operation = this.odata.bindContext("ProcurementService.prepare(...)", this.selectedBinding!.getBoundContext());
    operation.setParameter("expectedVersion", comparison.caseVersion);
    operation.setParameter("expectedOfferFingerprint", offer.fingerprint);
    operation.setParameter("offerID", offer.ID);
    operation.setParameter("reason", reason);
    operation.setParameter("extraCostReason", extraCostReason);
    this.ui.setProperty("/saving", true);
    try {
      await operation.invoke("$single");
      this.dialog?.close();
      this.openDecision();
    } catch (error) { MessageBox.error(this.message(error, "saveFailed")); }
    finally { operation.destroy(); this.ui.setProperty("/saving", false); }
  }
  openDecision(): void {
    const item = this.ui.getProperty("/selected") as ProcurementCase;
    if (!item) return;
    const url = new URL("/decisions/webapp/index.html", location.origin);
    url.searchParams.set("sap-ui-language", document.documentElement.lang);
    url.hash = `DecisionWorkspaces(ID=${item.ID},IsActiveEntity=true)`;
    location.assign(url.href);
  }
  onExit(): void {
    window.removeEventListener("hashchange", this.onHash);
    this.selectionSerial++;
    this.selectedBinding?.destroy();
    this.dialog?.destroy();
    this.ui.destroy();
  }
}
