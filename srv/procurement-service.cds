using { procurement as db } from '../db/schema';

@path: '/procurement'
@requires: 'authenticated-user'
service ProcurementService {
  @restrict: [{ grant: 'READ', to: ['Buyer', 'Approver', 'Reader'] }]
  entity Materials as projection on db.Materials;
  @restrict: [{ grant: 'READ', to: ['Buyer', 'Approver', 'Reader'] }]
  entity Suppliers as projection on db.Suppliers;
  @restrict: [{ grant: 'READ', to: ['Buyer', 'Approver', 'Reader'] }]
  entity Demands as projection on db.Demands;
  @restrict: [{ grant: 'READ', to: ['Buyer', 'Approver', 'Reader'] }]
  entity Offers as projection on db.Offers;
  @restrict: [{ grant: 'READ', to: ['Buyer', 'Approver', 'Reader'], where: 'procurementCase.demoScope = $user.demoScope' }]
  entity Submissions as projection on db.Submissions;
  @restrict: [{ grant: 'READ', to: ['Buyer', 'Approver', 'Reader'], where: 'procurementCase.demoScope = $user.demoScope' }]
  entity History as projection on db.History;

  @restrict: [
    { grant: 'READ', to: ['Buyer', 'Approver', 'Reader'], where: 'demoScope = $user.demoScope' },
    { grant: 'retryTransfer', to: ['Buyer', 'Approver'], where: 'demoScope = $user.demoScope' },
    { grant: 'compareOffers', to: ['Buyer', 'Approver', 'Reader'], where: 'demoScope = $user.demoScope' },
    { grant: ['prepare', 'submit', 'withdraw', 'reopen'], to: 'Buyer', where: 'demoScope = $user.demoScope' },
    { grant: ['approve', 'decline'], to: 'Approver', where: 'demoScope = $user.demoScope' }
  ]
  entity Cases as projection on db.Cases excluding { demoSession } actions {
    function compareOffers() returns OfferComparison;
    action retryTransfer(expectedVersion: Integer not null) returns Cases;
    action prepare(expectedVersion: Integer not null, offerID: UUID not null,
      reason: String(2000), extraCostReason: String(2000), expectedOfferFingerprint: String(64)) returns Cases;
    action submit(expectedVersion: Integer not null) returns Cases;
    action withdraw(expectedVersion: Integer not null) returns Cases;
    action reopen(expectedVersion: Integer not null) returns Cases;
    action approve(expectedVersion: Integer not null) returns Cases;
    action decline(expectedVersion: Integer not null, reason: String(2000) not null) returns Cases;
  };

  @cds.search: { procurementCase.caseNumber, procurementCase.title, procurementCase.demand.material.name,
    procurementCase.demand.material.code, procurementCase.demand.location, procurementCase.demand.orderReference,
    procurementCase.statusInfo.name, selectedOffer.supplier.name }
  @odata.draft.enabled
  @restrict: [
    { grant: 'READ', to: ['Buyer', 'Approver', 'Reader'], where: 'procurementCase.demoScope = $user.demoScope' },
    { grant: 'UPDATE', to: 'Buyer', where: 'procurementCase.demoScope = $user.demoScope' }
  ]
  entity DecisionWorkspaces as projection on db.DecisionWorkspaces {
    *,
    virtual canEdit : Boolean,
    virtual canSubmit : Boolean,
    virtual canWithdraw : Boolean,
    virtual canReopen : Boolean,
    virtual canApprove : Boolean,
    virtual canDecline : Boolean,
    virtual canRetryTransfer : Boolean
  };

  @restrict: [{ grant: 'READ', to: ['Buyer', 'Approver', 'Reader'] }]
  entity CaseStatuses as projection on db.CaseStatuses;
  @restrict: [{ grant: 'READ', to: ['Buyer', 'Approver', 'Reader'] }]
  entity HistoryEvents as projection on db.HistoryEvents;

  @restrict: [{ grant: 'READ', to: ['Buyer', 'Approver', 'Reader'], where: 'procurementCase.demoScope = $user.demoScope' }]
  entity Transfers as projection on db.Transfers excluding { payload, claimID, leaseUntil };
  @restrict: [{ grant: 'READ', to: ['Buyer', 'Approver', 'Reader'], where: 'transfer.procurementCase.demoScope = $user.demoScope' }]
  entity TransferAttempts as projection on db.TransferAttempts;
  @restrict: [{ grant: 'READ', to: ['Buyer', 'Approver', 'Reader'] }]
  entity TransferStatuses as projection on db.TransferStatuses;

  @restrict: [{ grant: 'READ', to: ['Buyer', 'Approver', 'Reader'] }]
  entity TransferErrors as projection on db.TransferErrors;

  type ComparedOffer {
    ID: UUID;
    supplierName: String(160);
    city: String(100);
    quantity: Integer;
    unit: String(10);
    currency: String(3);
    unitPrice: db.Money;
    shipping: db.Money;
    deliveryDate: Date;
    validUntil: Date;
    totalCost: db.Money;
    extraCost: db.Money;
    delayDays: Integer;
    needsExtraReason: Boolean;
    isReference: Boolean;
    isSelected: Boolean;
    available: Boolean;
    unavailableCode: String(40);
    fingerprint: String(64);
  }
  type OfferComparison {
    caseID: UUID;
    caseVersion: Integer;
    evaluationDate: Date;
    requiredOn: Date;
    referenceTotal: db.Money;
    currency: String(3);
    offers: array of ComparedOffer;
  }
  type CockpitSummary {
    evaluationDate: Date;
    urgentUntil: Date;
    total: Integer;
    open: Integer;
    urgent: Integer;
    submitted: Integer;
    approved: Integer;
  }
  @requires: ['Buyer', 'Approver', 'Reader']
  function cockpitSummary() returns CockpitSummary;

  type Session {
    userID: String;
    roles: array of String;
    evaluationDate: Date;
  }
  @requires: ['Buyer', 'Approver', 'Reader']
  function session() returns Session;
}

annotate ProcurementService.DecisionWorkspaces with {
  modifiedAt @odata.etag;
};

// Search the visible business descriptions, including localized names and optional associations.
annotate ProcurementService.Cases with @cds.search: {
  caseNumber, title, demand.material.name, demand.material.code, demand.location, demand.orderReference,
  statusInfo.name, selectedOffer.supplier.name
};
annotate ProcurementService.History with @cds.search: { eventInfo.name, actor, reason };
annotate ProcurementService.Offers with @cds.search: { supplier.name, material.name, material.code, unit, currency };
annotate ProcurementService.Suppliers with @cds.search: { name, city };
annotate ProcurementService.Materials with @cds.search: { name, code, unit };
annotate ProcurementService.CaseStatuses with @cds.search: { name, code };
