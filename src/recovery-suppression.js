const patterns = Object.freeze([
  ["opt_out", /\b(unsubscribe|stop (?:emailing|contacting)|do not (?:email|contact)|remove me)\b/i],
  ["complaint", /\b(spam complaint|reported? (?:this )?(?:email|message) as spam|harassment)\b/i],
  ["dispute", /\b(i dispute|not my application|identity theft|fraudulent application)\b/i],
  ["invalid", /\b(address rejected|recipient invalid|mailbox (?:does not exist|unavailable))\b/i],
  ["bounce", /\b(undeliverable|delivery status notification|permanent delivery failure)\b/i]
]);
export function suppressionFromCorrespondence(message = {}) {
  const text = `${message.subject || ""}\n${message.text || ""}`;
  const matched = patterns.find(([, pattern]) => pattern.test(text));
  if (!matched) return null;
  return { reason: matched[0], source: "neo_inbound", sourceEventId: String(message.messageId || `${message.mailboxId}:${message.uid}`), evidenceId: String(message.messageId || `${message.mailboxId}:${message.uid}`), email: message.from };
}
