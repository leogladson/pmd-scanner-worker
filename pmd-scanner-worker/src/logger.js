function formatMessage(level, message, meta) {
  const base = `[pmd-scanner-worker] ${new Date().toISOString()} ${level} ${message}`;
  if (!meta) {
    return base;
  }
  return `${base} ${JSON.stringify(meta)}`;
}

export const log = {
  info(message, meta) {
    console.log(formatMessage('INFO', message, meta));
  },
  warn(message, meta) {
    console.warn(formatMessage('WARN', message, meta));
  },
  error(message, meta) {
    console.error(formatMessage('ERROR', message, meta));
  }
};
