import DateFormat from "sap/ui/core/format/DateFormat";
import NumberFormat from "sap/ui/core/format/NumberFormat";
import { ValueState } from "sap/ui/core/library";

/** Convert a calendar day to a local date; never parse Edm.Date as a UTC instant. */
export function calendarDate(value: string, hours = 12): Date {
  const parts = value.split("-").map(Number);
  return new Date(parts[0]!, parts[1]! - 1, parts[2]!, hours);
}
export default {
  date(value?: string): string { return value ? DateFormat.getDateInstance({ style: "medium" }).format(calendarDate(value)) : "–"; },
  timestamp(value?: string | null): string { return value ? DateFormat.getDateTimeInstance({ style: "medium" }).format(new Date(value)) : "–"; },
  transferState(value?: string): ValueState { return value === "Succeeded" ? ValueState.Success : value === "Failed" ? ValueState.Error : value === "Retry" ? ValueState.Warning : ValueState.Information; },
  shortDate(value: string): string { return DateFormat.getDateInstance({ format: "MMMd" }).format(calendarDate(value)); },
  money(value: string | null | undefined, currency: string): string {
    return value == null ? "–" : NumberFormat.getCurrencyInstance({ currencyCode: true }).format([value, currency]);
  },
  number(value: string | null | undefined): string {
    return value == null ? "–" : NumberFormat.getFloatInstance({ minFractionDigits: 2, maxFractionDigits: 2 }).format(value);
  },
  costState(value: string | null): ValueState { return value != null && Number(value) > 0 ? ValueState.Warning : ValueState.None; },
  status(value: string): ValueState {
    return value === "Approved" || value === "Ordered" ? ValueState.Success : value === "Rejected" ? ValueState.Error : value === "Submitted" ? ValueState.Information : ValueState.None;
  }
};
