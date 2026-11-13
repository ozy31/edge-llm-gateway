// Redaction of obvious personal and payment data before a prompt leaves for
// an upstream marked `redact: true` (typically a third-party provider). It is
// a safety net for accidents, not a DLP product: it catches well-formed
// e-mail addresses, card numbers that pass the Luhn check and IBANs that pass
// the mod-97 check, and nothing else.

export interface Redaction {
  text: string;
  count: number;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const CARD = /\b(?:\d[ -]?){12,18}\d\b/g;
const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g;

export function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function ibanValid(raw: string): boolean {
  const iban = raw.replace(/ /g, "");
  if (iban.length < 15 || iban.length > 34) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

export function redactText(input: string): Redaction {
  let count = 0;
  let text = input.replace(EMAIL, () => {
    count++;
    return "[EMAIL]";
  });
  text = text.replace(IBAN, (m) => {
    if (!ibanValid(m)) return m;
    count++;
    return "[IBAN]";
  });
  text = text.replace(CARD, (m) => {
    const digits = m.replace(/[ -]/g, "");
    if (digits.length < 13 || digits.length > 19 || !luhn(digits)) return m;
    count++;
    return "[CARD]";
  });
  return { text, count };
}

// Redacts string content and text parts ({type:"text", text}) of every message.
export function redactMessages<T extends { content: unknown }>(messages: T[]): { messages: T[]; count: number } {
  let count = 0;
  const out = messages.map((m) => {
    if (typeof m.content === "string") {
      const r = redactText(m.content);
      count += r.count;
      return { ...m, content: r.text };
    }
    if (Array.isArray(m.content)) {
      const parts = m.content.map((p: unknown) => {
        if (typeof p === "object" && p !== null && (p as { type?: unknown }).type === "text" && typeof (p as { text?: unknown }).text === "string") {
          const r = redactText((p as { text: string }).text);
          count += r.count;
          return { ...p, text: r.text };
        }
        return p;
      });
      return { ...m, content: parts };
    }
    return m;
  });
  return { messages: out, count };
}
