// A failure the terminal can show as one sentence, with the exit code it
// carries. 3 is "the command could not do what it was asked"; the verdict
// codes 0–2 are never thrown.
export class CliError extends Error {
  constructor(message, code = 3) {
    super(message);
    this.exitCode = code;
  }
}
