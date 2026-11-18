using ProcurementService as S from '../../srv/procurement-service';

annotate S.DecisionWorkspaces with @(
  UI.HeaderInfo: { TypeName: '{i18n>Case}', TypeNamePlural: '{i18n>Cases}',
    Title: { $Type: 'UI.DataField', Value: procurementCase.caseNumber },
    Description: { $Type: 'UI.DataField', Value: procurementCase.title } },
  UI.CreateHidden: true, UI.DeleteHidden: true, UI.UpdateHidden: (not canEdit),
  Capabilities.InsertRestrictions.Insertable: false,
  Capabilities.DeleteRestrictions.Deletable: false,
  UI.SelectionFields: [procurementCase.caseNumber, procurementCase.status],
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: procurementCase.caseNumber, Label: '{i18n>CaseNumber}' },
    { $Type: 'UI.DataField', Value: procurementCase.title, Label: '{i18n>Need}' },
    { $Type: 'UI.DataField', Value: procurementCase.status, Label: '{i18n>Status}' },
    { $Type: 'UI.DataField', Value: procurementCase.demand.requiredOn, Label: '{i18n>RequiredOn}' },
    { $Type: 'UI.DataField', Value: selectedOffer_ID, Label: '{i18n>SelectedOffer}' },
    { $Type: 'UI.DataField', Value: procurementCase.totalCost, Label: '{i18n>TotalCost}' }
  ],
  UI.HeaderFacets: [
    { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#Status' },
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#Total' },
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#Extra' }
  ],
  UI.DataPoint #Total: { Title: '{i18n>TotalCost}', Value: procurementCase.totalCost },
  UI.DataPoint #Extra: { Title: '{i18n>ExtraCost}', Value: procurementCase.extraCost },
  UI.FieldGroup #Status: { Data: [
    { Value: procurementCase.status, Label: '{i18n>Status}' },
    { Value: procurementCase.demand.requiredOn, Label: '{i18n>RequiredOn}' }
  ] },
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', ID: 'Decision', Label: '{i18n>Decision}', Target: '@UI.FieldGroup#Decision' },
    { $Type: 'UI.ReferenceFacet', ID: 'Demand', Label: '{i18n>Demand}', Target: '@UI.FieldGroup#Demand' },
    { $Type: 'UI.ReferenceFacet', ID: 'Comparison', Label: '{i18n>Comparison}', Target: '@UI.FieldGroup#Comparison' },
    { $Type: 'UI.ReferenceFacet', ID: 'Transfer', Label: '{i18n>Transfer}', Target: '@UI.FieldGroup#Transfer', ![@UI.Hidden]: (procurementCase.transfer.ID = null) },
    { $Type: 'UI.ReferenceFacet', ID: 'History', Label: '{i18n>History}', Target: 'procurementCase/history/@UI.PresentationVariant' }
  ],
  UI.FieldGroup #Transfer: { Data: [
    { Value: procurementCase.transfer.status, Label: '{i18n>TransferStatus}' },
    { Value: procurementCase.transfer.attemptCount, Label: '{i18n>TransferAttempts}' },
    { Value: procurementCase.transfer.nextAttemptAt, Label: '{i18n>NextTransferAttempt}' },
    { Value: procurementCase.transfer.lastErrorCode, Label: '{i18n>LastTransferError}' },
    { Value: procurementCase.orderNumber, Label: '{i18n>OrderNumber}' },
    { Value: procurementCase.orderedAt, Label: '{i18n>OrderedAt}' }
  ] },
  UI.FieldGroup #Decision: { Data: [
    { Value: selectedOffer_ID, Label: '{i18n>SelectedOffer}' },
    { Value: reason, Label: '{i18n>Reason}' },
    { Value: extraCostReason, Label: '{i18n>ExtraReason}' }
  ] },
  UI.FieldGroup #Demand: { Data: [
    { Value: procurementCase.demand.material.name, Label: '{i18n>Material}' },
    { Value: procurementCase.demand.quantity, Label: '{i18n>Quantity}' },
    { Value: procurementCase.demand.requiredOn, Label: '{i18n>RequiredOn}' },
    { Value: procurementCase.demand.location, Label: '{i18n>Location}' },
    { Value: procurementCase.demand.orderReference, Label: '{i18n>OrderReference}' }
  ] },
  UI.FieldGroup #Comparison: { Data: [
    { Value: procurementCase.referenceTotal, Label: '{i18n>ReferenceTotal}' },
    { Value: procurementCase.referenceDeliveryDate, Label: '{i18n>ReferenceDelivery}' },
    { Value: procurementCase.selectedOffer.deliveryDate, Label: '{i18n>SelectedDelivery}' },
    { Value: procurementCase.totalCost, Label: '{i18n>TotalCost}' },
    { Value: procurementCase.extraCost, Label: '{i18n>ExtraCost}' },
    { Value: procurementCase.delayDays, Label: '{i18n>DelayDays}' }
  ] }
) {
  ID @UI.Hidden;
  baseCaseVersion @UI.Hidden;
  canEdit @UI.Hidden;
  canSubmit @UI.Hidden;
  canWithdraw @UI.Hidden;
  canReopen @UI.Hidden;
  canApprove @UI.Hidden;
  canDecline @UI.Hidden;
  canRetryTransfer @UI.Hidden;
  createdAt @UI.Hidden;
  createdBy @UI.Hidden;
  modifiedAt @UI.Hidden;
  modifiedBy @UI.Hidden;
  reason @title: '{i18n>Reason}' @UI.MultiLineText;
  extraCostReason @title: '{i18n>ExtraReason}' @UI.MultiLineText @Common.QuickInfo: '{i18n>ExtraReasonHint}';
  selectedOffer @Common.Text: selectedOffer.supplier.name @Common.TextArrangement: #TextOnly @title: '{i18n>SelectedOffer}' @Common.ValueList: {
    Label: '{i18n>Offers}', CollectionPath: 'Offers', SearchSupported: true,
    Parameters: [
      { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: selectedOffer_ID, ValueListProperty: 'ID' },
      { $Type: 'Common.ValueListParameterIn', LocalDataProperty: procurementCase.demand.material_ID, ValueListProperty: 'material_ID' },
      { $Type: 'Common.ValueListParameterIn', LocalDataProperty: procurementCase.demand.quantity, ValueListProperty: 'quantity' },
      { $Type: 'Common.ValueListParameterIn', LocalDataProperty: procurementCase.demand.unit, ValueListProperty: 'unit' },
      { $Type: 'Common.ValueListParameterIn', LocalDataProperty: procurementCase.referenceCurrency, ValueListProperty: 'currency' },
      { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'supplier/name' },
      { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'deliveryDate' },
      { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'unitPrice' },
      { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'shipping' },
      { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'validUntil' }
    ]
  };
};

annotate S.Cases with {
  caseNumber @title: '{i18n>CaseNumber}' @Common.FieldControl: #ReadOnly;
  title @title: '{i18n>Need}' @Common.FieldControl: #ReadOnly;
  status @title: '{i18n>Status}' @Common.Text: statusInfo.name @Common.TextArrangement: #TextOnly @Common.FieldControl: #ReadOnly
    @Common.ValueListWithFixedValues: true
    @Common.ValueList: { CollectionPath: 'CaseStatuses', Parameters: [
      { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: status, ValueListProperty: 'code' },
      { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' }
    ] };
  referenceCurrency @Common.FieldControl: #ReadOnly;
  referenceTotal @title: '{i18n>ReferenceTotal}' @Measures.ISOCurrency: referenceCurrency @Common.FieldControl: #ReadOnly;
  referenceDeliveryDate @title: '{i18n>ReferenceDelivery}' @Common.FieldControl: #ReadOnly;
  totalCost @title: '{i18n>TotalCost}' @Measures.ISOCurrency: referenceCurrency @Common.FieldControl: #ReadOnly;
  extraCost @title: '{i18n>ExtraCost}' @Measures.ISOCurrency: referenceCurrency @Common.FieldControl: #ReadOnly;
  delayDays @title: '{i18n>DelayDays}' @Common.FieldControl: #ReadOnly;
};
annotate S.Demands with {
  quantity @title: '{i18n>Quantity}' @Measures.Unit: unit @Common.FieldControl: #ReadOnly;
  unit @Common.FieldControl: #ReadOnly;
  requiredOn @title: '{i18n>RequiredOn}' @Common.FieldControl: #ReadOnly;
  location @title: '{i18n>Location}' @Common.FieldControl: #ReadOnly;
  orderReference @title: '{i18n>OrderReference}' @Common.FieldControl: #ReadOnly;
};
annotate S.Materials with { name @title: '{i18n>Material}' @Common.FieldControl: #ReadOnly; };
annotate S.Suppliers with { name @title: '{i18n>Supplier}'; };
annotate S.Offers with {
  ID @UI.HiddenFilter @title: '{i18n>Supplier}' @Common.Text: supplier.name @Common.TextArrangement: #TextOnly;
  supplier @UI.Hidden;
  material @UI.Hidden;
  currency @UI.Hidden;
  quantity @title: '{i18n>Quantity}';
  unit @title: '{i18n>Unit}';
  unitPrice @title: '{i18n>UnitPrice}' @Measures.ISOCurrency: currency;
  shipping @title: '{i18n>Shipping}' @Measures.ISOCurrency: currency;
  deliveryDate @title: '{i18n>DeliveryDate}' @Common.FieldControl: #ReadOnly;
  validUntil @title: '{i18n>ValidUntil}';
  version @title: '{i18n>Version}';
};
annotate S.History with @(
  UI.PresentationVariant: {
    SortOrder: [
      { Property: occurredAt, Descending: true },
      { Property: caseVersion, Descending: true }
    ],
    Visualizations: ['@UI.LineItem']
  },
  UI.CreateHidden: true, UI.UpdateHidden: true, UI.DeleteHidden: true,
  Capabilities.InsertRestrictions.Insertable: false,
  Capabilities.UpdateRestrictions.Updatable: false,
  Capabilities.DeleteRestrictions.Deletable: false
);
annotate S.History with @UI.LineItem: [
  { Value: event, Label: '{i18n>Event}' }, { Value: actor, Label: '{i18n>Actor}' },
  { Value: occurredAt, Label: '{i18n>OccurredAt}' }, { Value: reason, Label: '{i18n>Comment}' }
] {
  event @title: '{i18n>Event}' @Common.Text: eventInfo.name @Common.TextArrangement: #TextOnly;
  actor @title: '{i18n>Actor}';
  occurredAt @title: '{i18n>OccurredAt}';
  reason @title: '{i18n>Comment}';
};

annotate S.HistoryEvents with { name @title: '{i18n>Event}'; };

annotate S.Transfers with {
  status @Common.Text: statusInfo.name @Common.TextArrangement: #TextOnly;
  lastErrorCode @Common.Text: errorInfo.name @Common.TextArrangement: #TextOnly;
};
