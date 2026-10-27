import { VERIFICATION_MESSAGE } from "../shared/seller";

const VERIFICATION_PHRASES = [
  "vui lòng xác minh",
  "verify to continue",
  "trượt để xác minh",
  "xác minh bạn là người dùng",
  "security check",
];

export function detectVerification(doc: Document): string | null {
  const widget = doc.querySelector(
    'iframe[src*="captcha"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], [id*="captcha"], [class*="captcha"]',
  );
  if (widget) return VERIFICATION_MESSAGE;
  const text = (doc.body?.textContent ?? "").slice(0, 4000).toLowerCase();
  if (VERIFICATION_PHRASES.some((phrase) => text.includes(phrase))) return VERIFICATION_MESSAGE;
  return null;
}
