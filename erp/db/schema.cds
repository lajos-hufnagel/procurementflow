namespace erp;

// A simulated ERP order is owned by this service and its database only.
@assert.unique.orderNumber: [orderNumber]
entity Orders {
  key operationID : String(36);
  demoSessionID : UUID;
  demoExpiresAt : Timestamp;
  schemaVersion : Integer not null;
  caseID : UUID not null;
  caseNumber : String(40) not null;
  submissionID : UUID not null;
  revision : Integer not null;
  offerID : UUID not null;
  offerVersion : Integer not null;
  validUntil : Date not null;
  materialID : UUID not null;
  supplierID : UUID not null;
  quantity : Integer not null;
  unit : String(10) not null;
  currency : String(3) not null;
  unitPrice : Decimal(15,2) not null;
  shipping : Decimal(15,2) not null;
  totalCost : Decimal(15,2) not null;
  deliveryDate : Date not null;
  @readonly payloadHash : String(64) not null;
  @readonly orderNumber : String(40) not null;
  @readonly createdAt : Timestamp not null;
}
