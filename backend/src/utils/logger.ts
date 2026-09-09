type LogFields = Record<string, string | number | boolean | null | undefined>;

function line(level: string, msg: string, fields?: LogFields): string {
  const ts = new Date().toISOString();
  const extra = fields
    ? " " + Object.entries(fields)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(" ")
    : "";
  return `[${ts}] ${level.padEnd(5)} ${msg}${extra}`;
}

// Deliberately does not accept raw request bodies or env vars, so secrets
// can't accidentally end up in logs.
export const logger = {
  info(msg: string, fields?: LogFields) {
    console.log(line("INFO", msg, fields));
  },
  warn(msg: string, fields?: LogFields) {
    console.warn(line("WARN", msg, fields));
  },
  error(msg: string, fields?: LogFields) {
    console.error(line("ERROR", msg, fields));
  },
};
