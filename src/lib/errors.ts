/** Error yang membawa kode mesin untuk field `error.code` di envelope. */
export class CliError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}
