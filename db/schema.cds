namespace procurement;

using { cuid, managed } from '@sap/cds/common';

type Money : Decimal(15, 2);
type CaseStatus : String(12) enum { Open; Submitted; Approved; Rejected; Ordered; };

entity Materials : cuid {
  code : String(40) not null;
  name : String(160) not null;
  unit : String(10) not null;
}

entity Suppliers : cuid {
  name : String(160) not null;
  city : String(100);
}

entity Demands : cuid {
  material : Association to Materials not null;
  quantity : Integer not null;
  unit : String(10) not null;
  requiredOn : Date not null;
  location : String(100);
  orderReference : String(40);
}

entity Offers : cuid {
  material : Association to Materials not null;
  supplier : Association to Suppliers not null;
  quantity : Integer not null;
  unit : String(10) not null;
  currency : String(3) not null;
  unitPrice : Money not null;
  shipping : Money not null;
  deliveryDate : Date not null;
  validUntil : Date not null;
  version : Integer not null default 1;
}

// Public visitors own separate case sets; the authenticated deployment uses "shared".
entity DemoSessions : cuid {
  tokenHash : String(64) not null;
  erpOutage : Boolean not null default false;
  createdAt : Timestamp not null;
  expiresAt : Timestamp not null;
}

@assert.unique.caseNumber: [demoScope, caseNumber]
entity Cases : cuid, managed {
  @UI.Hidden @readonly demoScope : String(36) not null default 'shared';
  @UI.Hidden demoSession : Association to DemoSessions on demoSession.ID = demoScope;
  caseNumber : String(40) not null;
  title : String(160) not null;
  demand : Association to Demands not null;
  status : CaseStatus not null default 'Open';
  statusInfo : Association to CaseStatuses on statusInfo.code = status;
  version : Integer not null default 0;
  referenceOffer : Association to Offers not null;
  referenceOfferVersion : Integer not null;
  referenceQuantity : Integer not null;
  referenceUnit : String(10) not null;
  referenceCurrency : String(3) not null;
  referenceUnitPrice : Money not null;
  referenceShipping : Money not null;
  referenceTotal : Money not null;
  referenceDeliveryDate : Date not null;
  selectedOffer : Association to Offers;
  selectedOfferFingerprint : String(64);
  reason : String(2000);
  extraCostReason : String(2000);
  totalCost : Money;
  extraCost : Money;
  delayDays : Integer;
  submissionSequence : Integer not null default 0;
  currentSubmission : Association to Submissions;
  transfer : Association to Transfers;
  orderNumber : String(40);
  orderedAt : Timestamp;
  submissions : Association to many Submissions on submissions.procurementCase = $self;
  history : Association to many History on history.procurementCase = $self;
}

@assert.unique.caseRevision: [procurementCase, revision]
entity Submissions : cuid {
  procurementCase : Association to Cases not null;
  revision : Integer not null;
  offer : Association to Offers not null;
  offerVersion : Integer not null;
  offerFingerprint : String(64) not null;
  material : Association to Materials not null;
  supplier : Association to Suppliers not null;
  quantity : Integer not null;
  unit : String(10) not null;
  currency : String(3) not null;
  unitPrice : Money not null;
  shipping : Money not null;
  totalCost : Money not null;
  referenceTotal : Money not null;
  extraCost : Money not null;
  delayDays : Integer not null;
  deliveryDate : Date not null;
  validUntil : Date not null;
  reason : String(2000) not null;
  extraCostReason : String(2000);
  submittedBy : String(255) not null;
  submittedAt : Timestamp not null;
  evaluatedOn : Date not null;
}

@assert.unique.caseVersion: [procurementCase, caseVersion]
entity History : cuid {
  procurementCase : Association to Cases not null;
  submission : Association to Submissions;
  event : String(30) not null;
  eventInfo : Association to HistoryEvents on eventInfo.code = event;
  fromStatus : CaseStatus not null;
  toStatus : CaseStatus not null;
  caseVersion : Integer not null;
  actor : String(255) not null;
  occurredAt : Timestamp not null;
  reason : String(2000);
}

// Technical editing workspace: one per case, never a second business status.
@assert.unique.workspaceCase: [procurementCase]
entity DecisionWorkspaces : cuid, managed {
  @readonly procurementCase : Association to Cases not null;
  @readonly baseCaseVersion : Integer not null default 0;
  selectedOffer : Association to Offers;
  reason : String(2000);
  extraCostReason : String(2000);
}

entity CaseStatuses {
  key code : CaseStatus;
  name : localized String(60);
}
entity HistoryEvents {
  key code : String(30);
  name : localized String(60);
}


type TransferStatus : String(16) enum { Pending; Processing; Retry; Succeeded; Failed; };

@assert.unique.transferRevision: [submission]
entity Transfers : cuid, managed {
  procurementCase : Association to Cases not null;
  submission : Association to Submissions not null;
  status : TransferStatus not null default 'Pending';
  statusInfo : Association to TransferStatuses on statusInfo.code = status;
  payload : LargeString not null;
  payloadHash : String(64) not null;
  version : Integer not null default 0;
  attemptCount : Integer not null default 0;
  failureCount : Integer not null default 0;
  nextAttemptAt : Timestamp;
  lastAttemptAt : Timestamp;
  claimID : UUID;
  leaseUntil : Timestamp;
  lastErrorCode : String(80);
  errorInfo : Association to TransferErrors on errorInfo.code = lastErrorCode;
  lastErrorMessage : String(1000);
  orderNumber : String(40);
  confirmedAt : Timestamp;
  attempts : Association to many TransferAttempts on attempts.transfer = $self;
}

@assert.unique.transferAttempt: [transfer, attemptNumber]
entity TransferAttempts : cuid {
  transfer : Association to Transfers not null;
  attemptNumber : Integer not null;
  startedAt : Timestamp not null;
  finishedAt : Timestamp;
  outcome : String(20) not null;
  errorCode : String(80);
}

entity TransferStatuses {
  key code : TransferStatus;
  name : localized String(60);
}

entity TransferErrors {
  key code : String(80);
  name : localized String(240);
}
