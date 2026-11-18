declare module "procurementflow/shared/ErrorMessage" {
  const ErrorMessage: {
    text(error: unknown, fallback?: string): string;
    isReportedActionError(error: unknown): boolean;
  };
  export default ErrorMessage;
}
