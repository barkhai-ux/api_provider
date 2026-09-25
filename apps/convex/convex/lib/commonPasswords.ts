/**
 * A small blocklist of common passwords that meet the length rule, plus
 * pattern checks. It is not a breach corpus: for that, add a k-anonymity
 * lookup (for example Have I Been Pwned) where outbound calls are allowed.
 */
const COMMON = new Set([
  "1234567890", "12345678910", "123456789012", "0123456789", "0987654321", "9876543210",
  "1111111111", "0000000000", "1234512345", "1122334455", "123123123123", "1q2w3e4r5t",
  "1qaz2wsx3edc", "qwertyuiop", "qwertyuiop123", "asdfghjkl1", "zxcvbnm123", "qwerty12345",
  "qwerty123456", "password12", "password123", "password1234", "password12345", "passw0rd123",
  "p@ssword123", "p@ssw0rd123", "iloveyou123", "princess123", "sunshine123", "football123",
  "baseball123", "superman123", "trustno1234", "letmein1234", "welcome123", "welcome1234",
  "changeme123", "administrator", "admin123456", "abcdefghij", "abcd123456", "abc1234567",
  "a1b2c3d4e5", "qazwsxedcrfv", "mongolia123", "ulaanbaatar", "ulaanbaatar1", "ulaanbaatar123",
  "geoplatform", "geoplatform1", "geoplatform123",
  "ubhub", "ubhubdev", "ubhubdev1", "ubhubdev123", "ubhublocation", "ubhublocationservice", "monmap", "monmap123",
]);

const SEQUENCES = ["0123456789012345", "9876543210987654", "abcdefghijklmnopqrstuvwxyz", "qwertyuiopasdfghjklzxcvbnm"];

export function isCommonPassword(password: string, email?: string): boolean {
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return true;
  // One repeated character or a short repeated chunk ("abcabcabcabc").
  if (/^(.{1,3})\1+$/u.test(lower)) return true;
  if (SEQUENCES.some((sequence) => sequence.includes(lower))) return true;
  if (email) {
    const local = email.split("@")[0]?.toLowerCase() ?? "";
    const stripped = lower.replace(/[^a-z]/g, "");
    if (lower === email.toLowerCase() || (local.length >= 4 && stripped === local.replace(/[^a-z]/g, ""))) return true;
  }
  return false;
}
