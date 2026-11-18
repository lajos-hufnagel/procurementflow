using ProcurementService as S from '../srv/procurement-service';

// Field labels also cover optional columns, sorting, grouping and filter dialogs.
// Labels on managed associations are propagated to their generated foreign keys.

annotate S.Materials with {
  ID @title: '{i18n>MaterialID}';
  code @title: '{i18n>MaterialCode}';
  unit @title: '{i18n>Unit}';
};

annotate S.Suppliers with {
  ID @title: '{i18n>SupplierID}';
  city @title: '{i18n>City}';
};

annotate S.Demands with {
  ID @title: '{i18n>DemandID}';
  material @title: '{i18n>MaterialID}';
  unit @title: '{i18n>Unit}';
};

annotate S.Offers with {
  material @title: '{i18n>MaterialID}';
  supplier @title: '{i18n>SupplierID}';
  currency @title: '{i18n>Currency}';
};

annotate S.Submissions with {
  ID @title: '{i18n>SubmissionID}';
  procurementCase @title: '{i18n>CaseID}';
  revision @title: '{i18n>SubmissionRevision}';
  offer @title: '{i18n>OfferID}';
  offerVersion @title: '{i18n>OfferVersion}';
  offerFingerprint @title: '{i18n>OfferFingerprint}';
  material @title: '{i18n>MaterialID}';
  supplier @title: '{i18n>SupplierID}';
  quantity @title: '{i18n>Quantity}';
  unit @title: '{i18n>Unit}';
  currency @title: '{i18n>Currency}';
  unitPrice @title: '{i18n>UnitPrice}';
  shipping @title: '{i18n>Shipping}';
  totalCost @title: '{i18n>TotalCost}';
  referenceTotal @title: '{i18n>ReferenceTotal}';
  extraCost @title: '{i18n>ExtraCost}';
  delayDays @title: '{i18n>DelayDays}';
  deliveryDate @title: '{i18n>DeliveryDate}';
  validUntil @title: '{i18n>ValidUntil}';
  reason @title: '{i18n>Reason}';
  extraCostReason @title: '{i18n>ExtraReason}';
  submittedBy @title: '{i18n>SubmittedBy}';
  submittedAt @title: '{i18n>SubmittedAt}';
  evaluatedOn @title: '{i18n>EvaluationDate}';
};

annotate S.History with {
  ID @title: '{i18n>HistoryID}';
  procurementCase @title: '{i18n>CaseID}';
  submission @title: '{i18n>SubmissionID}';
  eventInfo @title: '{i18n>Event}';
  fromStatus @title: '{i18n>PreviousStatus}';
  toStatus @title: '{i18n>NextStatus}';
  caseVersion @title: '{i18n>CaseVersion}';
};

annotate S.Cases with {
  ID @title: '{i18n>CaseID}';
  demand @title: '{i18n>DemandID}';
  statusInfo @title: '{i18n>Status}';
  version @title: '{i18n>CaseVersion}';
  referenceOffer @title: '{i18n>ReferenceOfferID}';
  referenceOfferVersion @title: '{i18n>ReferenceOfferVersion}';
  referenceQuantity @title: '{i18n>ReferenceQuantity}';
  referenceUnit @title: '{i18n>ReferenceUnit}';
  referenceCurrency @title: '{i18n>ReferenceCurrency}';
  referenceUnitPrice @title: '{i18n>ReferenceUnitPrice}';
  referenceShipping @title: '{i18n>ReferenceShipping}';
  selectedOffer @title: '{i18n>SelectedOfferID}';
  selectedOfferFingerprint @title: '{i18n>SelectedOfferFingerprint}';
  reason @title: '{i18n>Reason}';
  extraCostReason @title: '{i18n>ExtraReason}';
  submissionSequence @title: '{i18n>SubmissionSequence}';
  currentSubmission @title: '{i18n>CurrentSubmissionID}';
  transfer @title: '{i18n>TransferID}';
  orderNumber @title: '{i18n>OrderNumber}';
  orderedAt @title: '{i18n>OrderedAt}';
  submissions @title: '{i18n>Submissions}';
  history @title: '{i18n>History}';
  createdAt @title: '{i18n>CreatedAt}';
  createdBy @title: '{i18n>CreatedBy}';
  modifiedAt @title: '{i18n>ModifiedAt}';
  modifiedBy @title: '{i18n>ModifiedBy}';
};

annotate S.DecisionWorkspaces with {
  ID @title: '{i18n>WorkspaceID}';
  procurementCase @title: '{i18n>CaseID}';
  baseCaseVersion @title: '{i18n>CaseVersion}';
  createdAt @title: '{i18n>CreatedAt}';
  createdBy @title: '{i18n>CreatedBy}';
  modifiedAt @title: '{i18n>ModifiedAt}';
  modifiedBy @title: '{i18n>ModifiedBy}';
};

annotate S.CaseStatuses with {
  code @title: '{i18n>StatusCode}';
  name @title: '{i18n>Status}';
  texts @title: '{i18n>Translations}';
  localized @title: '{i18n>LocalizedText}';
};

annotate S.HistoryEvents with {
  code @title: '{i18n>EventCode}';
  texts @title: '{i18n>Translations}';
  localized @title: '{i18n>LocalizedText}';
};

annotate S.Transfers with {
  ID @title: '{i18n>TransferID}';
  procurementCase @title: '{i18n>CaseID}';
  submission @title: '{i18n>SubmissionID}';
  status @title: '{i18n>TransferStatus}';
  statusInfo @title: '{i18n>TransferStatus}';
  payloadHash @title: '{i18n>PayloadHash}';
  version @title: '{i18n>TransferVersion}';
  attemptCount @title: '{i18n>TransferAttempts}';
  failureCount @title: '{i18n>FailureCount}';
  nextAttemptAt @title: '{i18n>NextTransferAttempt}';
  lastAttemptAt @title: '{i18n>LastAttemptAt}';
  lastErrorCode @title: '{i18n>LastTransferError}';
  errorInfo @title: '{i18n>LastTransferError}';
  lastErrorMessage @title: '{i18n>ErrorDetails}';
  orderNumber @title: '{i18n>OrderNumber}';
  confirmedAt @title: '{i18n>ConfirmedAt}';
  attempts @title: '{i18n>TransferAttempts}';
  createdAt @title: '{i18n>CreatedAt}';
  createdBy @title: '{i18n>CreatedBy}';
  modifiedAt @title: '{i18n>ModifiedAt}';
  modifiedBy @title: '{i18n>ModifiedBy}';
};

annotate S.TransferAttempts with {
  ID @title: '{i18n>TransferAttemptID}';
  transfer @title: '{i18n>TransferID}';
  attemptNumber @title: '{i18n>AttemptNumber}';
  startedAt @title: '{i18n>StartedAt}';
  finishedAt @title: '{i18n>FinishedAt}';
  outcome @title: '{i18n>Outcome}';
  errorCode @title: '{i18n>ErrorCode}';
};

annotate S.TransferStatuses with {
  code @title: '{i18n>TransferStatusCode}';
  name @title: '{i18n>TransferStatus}';
  texts @title: '{i18n>Translations}';
  localized @title: '{i18n>LocalizedText}';
};

annotate S.TransferErrors with {
  code @title: '{i18n>ErrorCode}';
  name @title: '{i18n>LastTransferError}';
  texts @title: '{i18n>Translations}';
  localized @title: '{i18n>LocalizedText}';
};

annotate S.CaseStatuses.texts with {
  code @title: '{i18n>StatusCode}';
  name @title: '{i18n>Status}';
};

annotate S.HistoryEvents.texts with {
  code @title: '{i18n>EventCode}';
  name @title: '{i18n>Event}';
};

annotate S.TransferStatuses.texts with {
  code @title: '{i18n>TransferStatusCode}';
  name @title: '{i18n>TransferStatus}';
};

annotate S.TransferErrors.texts with {
  code @title: '{i18n>ErrorCode}';
  name @title: '{i18n>LastTransferError}';
};
