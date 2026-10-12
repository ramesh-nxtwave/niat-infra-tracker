export class PendingReportError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "PendingReportError";
  }
}
