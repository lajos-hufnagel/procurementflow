import cds from '@sap/cds';
import assert from 'node:assert/strict';
import { calendarDay, fingerprint, type Offer } from './rules.ts';
import { payloadHash, type OrderPayload } from '../integration/contract.ts';

export interface DemoCalendar {
  from: string; to: string;
  demands: { ID: string; requiredOn: string }[];
  offers: { ID: string; deliveryDate: string; validUntil: string }[];
}
type Row = Record<string, any>;
type Change = { entity: string; key: Record<string, unknown>; before: Row; after: Row };
const { SELECT, UPDATE, INSERT } = cds.ql;
const event = 'DemoDatesShifted';

export function shiftDay(value: string, days: number): string {
  return new Date((calendarDay(value) + days) * 86400000).toISOString().slice(0, 10);
}

/** Explicit operator-only correction of the synthetic calendar, never a startup hook or public action. */
export async function shiftDemoDates(db: any, calendar: DemoCalendar, apply = false) {
  const days = calendarDay(calendar.to) - calendarDay(calendar.from);
  assert.ok(days > 0, 'The target evaluation date must follow the original date');
  const shift = (value: string) => shiftDay(value, days);
  return db.tx(async (tx: any) => {
    const read = (entity: string) => tx.run(SELECT.from(entity)) as Promise<Row[]>;
    const demands = await read('procurement.Demands');
    const offers = await read('procurement.Offers');
    assert.equal(demands.length, calendar.demands.length, 'Unexpected demand catalog; nothing changed');
    assert.equal(offers.length, calendar.offers.length, 'Unexpected offer catalog; nothing changed');
    const demandDates = new Map(calendar.demands.map(row => [row.ID, row]));
    const offerDates = new Map(calendar.offers.map(row => [row.ID, row]));
    const states = new Set<string>();
    for (const [rows, originals, fields] of [
      [demands, demandDates, ['requiredOn']], [offers, offerDates, ['deliveryDate', 'validUntil']]
    ] as const) {
      for (const row of rows) {
        const original = originals.get(row.ID) as Row | undefined;
        assert.ok(original, 'Unknown catalog ID; nothing changed');
        const before = fields.every(field => row[field] === original[field]);
        const after = fields.every(field => row[field] === shift(original[field]));
        assert.ok(before || after, 'Unexpected catalog dates; nothing changed');
        states.add(before ? 'before' : 'after');
      }
    }
    assert.equal(states.size, 1, 'Mixed calendar state; nothing changed');
    if (states.has('after')) return { applied: false, alreadyShifted: true, counts: {}, backup: [] as Change[], historyIDs: [] as string[] };

    const cases = await read('procurement.Cases');
    const submissions = await read('procurement.Submissions');
    const transfers = await read('procurement.Transfers');
    const workspaces = await read('procurement.DecisionWorkspaces');
    const drafts = await read('ProcurementService.DecisionWorkspaces.drafts');
    assert.ok(transfers.every(row => row.status !== 'Processing'), 'A transfer is running; stop writers before migration');
    const changes: Change[] = [];
    const history: Row[] = [];
    const add = (entity: string, row: Row, after: Row, key = { ID: row.ID }) => changes.push({
      entity, key, before: Object.fromEntries(Object.keys(after).map(field => [field, row[field] ?? null])), after
    });
    const actualOffers = new Map(offers.map(row => [row.ID, row]));
    const now = new Date().toISOString();
    let staleSelectionsPreserved = 0;
    for (const row of demands) add('procurement.Demands', row, { requiredOn: shift(row.requiredOn) });
    for (const row of offers) add('procurement.Offers', row, { deliveryDate: shift(row.deliveryDate), validUntil: shift(row.validUntil) });
    for (const row of cases) {
      assert.ok(demandDates.has(row.demand_ID) && offerDates.has(row.referenceOffer_ID), 'Unknown case catalog reference');
      assert.equal(row.referenceDeliveryDate, offerDates.get(row.referenceOffer_ID)!.deliveryDate, 'Unexpected frozen reference date');
      const after: Row = { referenceDeliveryDate: shift(row.referenceDeliveryDate), version: row.version + 1,
        modifiedAt: now, modifiedBy: 'demo-calendar-migration' };
      if (row.selectedOfferFingerprint) {
        const offer = actualOffers.get(row.selectedOffer_ID);
        assert.ok(offer, 'Missing selected offer');
        if (row.selectedOfferFingerprint === fingerprint(offer as Offer)) {
          after.selectedOfferFingerprint = fingerprint({ ...offer, deliveryDate: shift(offer.deliveryDate), validUntil: shift(offer.validUntil) } as Offer);
        } else {
          // A previously invalid selection must not become valid merely because the calendar moved.
          staleSelectionsPreserved++;
        }
      }
      add('procurement.Cases', row, after);
      history.push({ ID: cds.utils.uuid(), procurementCase_ID: row.ID, submission_ID: row.currentSubmission_ID,
        event, fromStatus: row.status, toStatus: row.status, caseVersion: after.version,
        actor: 'demo-calendar-migration', occurredAt: now, reason: calendar.from + ' → ' + calendar.to + ' (+' + days + ')' });
    }
    for (const row of submissions) {
      const original = offerDates.get(row.offer_ID);
      assert.ok(original, 'Unknown submitted offer');
      assert.equal(row.deliveryDate, original.deliveryDate, 'Unexpected submission delivery date');
      assert.equal(row.validUntil, original.validUntil, 'Unexpected submission expiry');
      const snapshot = { ...row, ID: row.offer_ID, version: row.offerVersion } as Offer;
      assert.equal(row.offerFingerprint, fingerprint(snapshot), 'Corrupt submitted snapshot; nothing changed');
      const shifted = { ...snapshot, deliveryDate: shift(row.deliveryDate), validUntil: shift(row.validUntil) };
      add('procurement.Submissions', row, { deliveryDate: shifted.deliveryDate, validUntil: shifted.validUntil,
        evaluatedOn: shift(row.evaluatedOn), offerFingerprint: fingerprint(shifted) });
    }
    for (const row of transfers) {
      const payload = JSON.parse(row.payload) as OrderPayload;
      assert.equal(row.payloadHash, payloadHash(payload), 'Corrupt transfer payload; nothing changed');
      const original = offerDates.get(payload.offerID);
      assert.ok(original, 'Unknown transfer offer');
      assert.equal(payload.deliveryDate, original.deliveryDate, 'Unexpected transfer delivery date');
      assert.equal(payload.validUntil, original.validUntil, 'Unexpected transfer expiry');
      const shifted = { ...payload, deliveryDate: shift(payload.deliveryDate), validUntil: shift(payload.validUntil) };
      add('procurement.Transfers', row, { payload: JSON.stringify(shifted), payloadHash: payloadHash(shifted),
        modifiedAt: row.modifiedAt, modifiedBy: row.modifiedBy });
    }
    const versions = new Map(cases.map(row => [row.ID, row.version]));
    for (const [entity, rows] of [
      ['procurement.DecisionWorkspaces', workspaces], ['ProcurementService.DecisionWorkspaces.drafts', drafts]
    ] as const) {
      for (const row of rows) {
        const version = versions.get(row.procurementCase_ID);
        assert.notEqual(version, undefined, 'Orphaned workspace; nothing changed');
        if (row.baseCaseVersion === version) {
          add(entity, row, { baseCaseVersion: version + 1, modifiedAt: row.modifiedAt, modifiedBy: row.modifiedBy });
        }
      }
    }
    const counts: Record<string, number> = {};
    for (const change of changes) counts[change.entity] = (counts[change.entity] ?? 0) + 1;
    if (apply) {
      if (!await tx.run(SELECT.one.from('procurement.HistoryEvents').where({ code: event }))) await tx.run(INSERT.into('procurement.HistoryEvents').entries({ code: event, name: 'Demo-Termine verschoben' }));
      if (!await tx.run(SELECT.one.from('procurement.HistoryEvents.texts').where({ locale: 'en', code: event }))) await tx.run(INSERT.into('procurement.HistoryEvents.texts').entries({ locale: 'en', code: event, name: 'Demo dates shifted' }));
      for (const change of changes) {
        const guard = Object.fromEntries(Object.entries(change.before).filter(([field]) => !['payload', 'modifiedAt', 'modifiedBy'].includes(field)));
        const changed = await tx.run(UPDATE.entity(change.entity).set(change.after).where({ ...change.key, ...guard }));
        assert.equal(changed, 1, 'Concurrent modification; all calendar changes rolled back');
      }
      if (history.length) await tx.run(INSERT.into('procurement.History').entries(history));
    }
    return { applied: apply, alreadyShifted: false, counts, staleSelectionsPreserved,
      backup: changes, historyIDs: apply ? history.map(row => row.ID as string) : [] };
  });
}
