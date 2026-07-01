const secretOptionNames = new Set([
  "--api-key",
  "--apikey",
  "--token",
  "--access-token",
  "--auth-token",
  "--bearer",
  "--secret",
  "--password",
  "--credential",
  "-k",
]);
const localPathPattern = /(^|[\s="'(:])((?:\/(?:Users|var|private|tmp|Volumes|home|usr|opt|etc)\/)[^\s"',)]+)/gu;

export function formatCommand(command, args, hiddenArgIndexes = new Set()) {
  return formatCommandLine([command, ...args], new Set([...hiddenArgIndexes].map((index) => index + 1)));
}

export function formatCommandLine(parts, hiddenIndexes = new Set()) {
  return parts.map((part, index) => quoteArg(redactArg(parts, part, index, hiddenIndexes))).join(" ");
}

export function redactSensitive(value) {
  return value
    .replace(/((?:--?(?:api[-_]?key|apikey|token|access-token|auth-token|bearer|secret|password|credential)|-k)=)(?:"[^"]*"|'[^']*'|\S+)/giu, "$1[redacted]")
    .replace(/\b(sk|pk|rk|api|token)-[a-z0-9_-]{8,}\b/giu, "[redacted]")
    .replace(/(api[_-]?key|token|authorization|bearer|secret|password|credential)(\s*[=:]\s*)\S+/giu, "$1$2[redacted]")
    .replace(localPathPattern, "$1[path-redacted]");
}

function redactArg(parts, part, index, hiddenIndexes) {
  if (hiddenIndexes.has(index)) return part === "-" ? "[prompt-redacted]" : "[path-redacted]";
  if (index > 0 && secretOptionNames.has(parts[index - 1]?.toLowerCase())) return "[redacted]";
  const inline = redactInlineArg(part);
  if (inline !== part) return inline;
  if (looksLikeLocalPath(part)) return "[path-redacted]";
  return redactSensitive(part);
}

function redactInlineArg(part) {
  const match = part.match(/^([^=]+)=(.+)$/u);
  if (!match) return part;
  const name = match[1].toLowerCase();
  const value = match[2];
  if (secretOptionNames.has(name) || /api[-_]?key|token|bearer|secret|password|credential/u.test(name)) {
    return `${match[1]}=[redacted]`;
  }
  if (looksLikeLocalPath(value)) return `${match[1]}=[path-redacted]`;
  return part;
}

function looksLikeLocalPath(value) {
  return /^(?:\/(?:Users|var|private|tmp|Volumes|home|usr|opt|etc)\/|[A-Za-z]:\\)/u.test(value);
}

function quoteArg(value) {
  return /^[a-z0-9_./:=@-]+$/iu.test(value) ? value : JSON.stringify(value);
}
