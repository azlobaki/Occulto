// Occulto - Local Keyed Scramble Engine
// Replaces sensitive data with realistic-looking fake values using an
// HMAC-SHA256 keyed RNG. Without the key, outputs cannot be brute-forced back
// to the original. No external APIs — everything runs locally.

type ScrambleType = 'email' | 'ipv4' | 'ipv6' | 'uuid' | 'mac' | 'card' | 'iban' | 'phone' | 'url' | 'domain' | 'text';

class Scrambler {
  private replacementCache = new Map<string, string>();
  private key: Uint8Array;

  // Without a key, an ephemeral random key is used (never an unkeyed seed).
  constructor(keyHex?: string) {
    this.key = keyHex !== undefined ? Scrambler.parseKey(keyHex) : Scrambler.randomKey();
  }

  setKey(keyHex: string): void {
    this.key = Scrambler.parseKey(keyHex);
    this.replacementCache.clear();
  }

  // Keys must be exactly 32 bytes; anything shorter would weaken the HMAC.
  private static parseKey(keyHex: string): Uint8Array {
    const key = OccultoCrypto.hexToBytes(keyHex);
    if (key.length !== 32) throw new Error('Scramble key must be 32 bytes (64 hex characters)');
    return key;
  }

  private static randomKey(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(32));
  }

  private pickRandom<T>(arr: T[], rng: KeyedRng): T {
    return arr[rng.int(arr.length)];
  }

  // --- Data pools for realistic replacements ---

  private static readonly FIRST_NAMES = [
    'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
    'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
    'Thomas', 'Sarah', 'Charles', 'Karen', 'Christopher', 'Lisa', 'Daniel', 'Nancy',
    'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra', 'Donald', 'Ashley',
    'Steven', 'Kimberly', 'Paul', 'Emily', 'Andrew', 'Donna', 'Joshua', 'Michelle',
    'Kenneth', 'Carol', 'Kevin', 'Amanda', 'Brian', 'Dorothy', 'George', 'Melissa',
    'Timothy', 'Deborah',
  ];

  private static readonly LAST_NAMES = [
    'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
    'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
    'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
    'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker',
    'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
    'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell',
    'Carter', 'Roberts',
  ];

  private static readonly DOMAINS = [
    'example.com', 'testmail.org', 'sampledomain.net', 'fakemail.io', 'mockdata.com',
    'placeholder.org', 'demosite.net', 'testorg.com', 'acmecorp.net', 'globex.io',
    'initech.com', 'umbrella.org', 'waynetech.net', 'starkindustries.io', 'cyberdyne.com',
    'oscorp.org', 'lexcorp.net', 'aperture.io', 'soylent.com', 'tyrell.org',
  ];

  private static readonly ORG_NAMES = [
    'Apex Solutions', 'Meridian Group', 'Vertex Industries', 'Cascade Systems',
    'Pinnacle Corp', 'Horizon Partners', 'Quantum Dynamics', 'Atlas Enterprises',
    'Nexus Technologies', 'Prism Analytics', 'Vanguard Holdings', 'Eclipse Networks',
    'Summit Digital', 'Zenith Consulting', 'Stratos Global', 'Forge Innovations',
    'Beacon Services', 'Cipher Security', 'Polaris Ventures', 'Titan Resources',
  ];

  // --- Type detection ---

  private static readonly EMAIL_REGEX = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
  private static readonly IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4]\d|1?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|1?\d{1,2})$/;
  private static readonly UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Accepts full and compressed (::) IPv6 forms.
  private static isIPv6(text: string): boolean {
    if (!/^[0-9a-fA-F:]+$/.test(text)) return false;
    if ((text.match(/:/g) || []).length < 2) return false;
    const doubleColons = text.split('::').length - 1;
    if (doubleColons > 1 || text.includes(':::')) return false;
    const groups = text.split(':').filter((g) => g !== '');
    if (!groups.every((g) => g.length >= 1 && g.length <= 4)) return false;
    if (doubleColons === 1) return groups.length <= 7;
    // No "::": exactly 8 groups, none empty (no leading/trailing single colon).
    return text.split(':').length === 8 && groups.length === 8;
  }

  private static readonly MAC_REGEX =
    /^[0-9A-Fa-f]{2}([:-])(?:[0-9A-Fa-f]{2}\1){4}[0-9A-Fa-f]{2}$|^[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}$/;
  private static readonly URL_REGEX = /^(https?:\/\/)([^/?#\s]+)(\S*)$/i;
  private static readonly DOMAIN_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

  static detectType(text: string): ScrambleType {
    if (Scrambler.EMAIL_REGEX.test(text)) return 'email';
    if (Scrambler.IPV4_REGEX.test(text)) return 'ipv4';
    if (Scrambler.isIPv6(text)) return 'ipv6';
    if (Scrambler.UUID_REGEX.test(text)) return 'uuid';
    if (Scrambler.MAC_REGEX.test(text)) return 'mac';
    if (/^[A-Z]{2}\d{2}[A-Z0-9 ]{11,40}$/.test(text) && OccultoValidators.iban(text)) return 'iban';
    const digits = text.replace(/\D/g, '').length;
    if (/^\d[\d -]{10,22}\d$/.test(text) && digits >= 12 && digits <= 19 && OccultoValidators.luhn(text)) return 'card';
    if (Scrambler.URL_REGEX.test(text)) return 'url';
    if (Scrambler.DOMAIN_REGEX.test(text)) return 'domain';
    // Phone: starts like a phone number, 8–15 digits.
    if (/^[+0(][\d\s().-]+$/.test(text) && digits >= 8 && digits <= 15) return 'phone';
    return 'text';
  }

  /**
   * Main entry point: returns a scrambled replacement for the given original text.
   * Results are cached so the same input always returns the same output.
   */
  scramble(original: string): string {
    const cached = this.replacementCache.get(original);
    if (cached !== undefined) return cached;

    const result = this.generateReplacement(original);
    this.replacementCache.set(original, result);
    return result;
  }

  clearCache(): void {
    this.replacementCache.clear();
  }

  private generateReplacement(original: string): string {
    const trimmed = original.trim();
    const rng = new KeyedRng(this.key, original);

    switch (Scrambler.detectType(trimmed)) {
      case 'email':
        return this.scrambleEmail(rng);
      case 'ipv4':
        return this.scrambleIPv4(rng);
      case 'ipv6':
        return this.scrambleIPv6(trimmed, rng);
      case 'uuid':
        return this.scrambleUUID(rng);
      case 'mac':
        return this.scrambleMac(trimmed, rng);
      case 'card':
        return this.scrambleCard(trimmed, rng);
      case 'iban':
        return this.scrambleIban(trimmed, rng);
      case 'phone':
        return this.scramblePhone(trimmed, rng);
      case 'url':
        return this.scrambleUrl(trimmed, rng);
      case 'domain':
        return this.scrambleDomain(trimmed, rng);
      default:
        return this.scrambleGenericText(original, rng);
    }
  }

  private scrambleEmail(rng: KeyedRng): string {
    const first = this.pickRandom(Scrambler.FIRST_NAMES, rng).toLowerCase();
    const last = this.pickRandom(Scrambler.LAST_NAMES, rng).toLowerCase();
    const domain = this.pickRandom(Scrambler.DOMAINS, rng);
    const separators = ['.', '_', ''];
    const sep = this.pickRandom(separators, rng);
    return `${first}${sep}${last}@${domain}`;
  }

  private scrambleIPv4(rng: KeyedRng): string {
    return [rng.int(256), rng.int(256), rng.int(256), rng.int(256)].join('.');
  }

  private static randomHex(rng: KeyedRng, length: number): string {
    let s = '';
    for (let i = 0; i < length; i++) s += rng.int(16).toString(16);
    return s;
  }

  private scrambleIPv6(original: string, rng: KeyedRng): string {
    // Preserve the structure (number of groups, :: placement, group lengths)
    return original
      .split(':')
      .map((part) => Scrambler.randomHex(rng, part.length))
      .join(':');
  }

  private scrambleUUID(rng: KeyedRng): string {
    const r = (len: number) => Scrambler.randomHex(rng, len);
    return `${r(8)}-${r(4)}-${r(4)}-${r(4)}-${r(12)}`;
  }

  // Hex digits stay hex (same case), separators stay.
  private scrambleMac(original: string, rng: KeyedRng): string {
    const upper = /[A-F]/.test(original);
    return original.replace(/[0-9A-Fa-f]/g, () => {
      const hex = rng.int(16).toString(16);
      return upper ? hex.toUpperCase() : hex;
    });
  }

  // Keeps the layout and first digit (card network); the last digit is a
  // valid Luhn check digit so the result still looks like a real card.
  private scrambleCard(original: string, rng: KeyedRng): string {
    const count = original.replace(/\D/g, '').length;
    const digits: number[] = [];
    for (let i = 0; i < count - 1; i++) digits.push(i === 0 ? Number(original.match(/\d/)?.[0]) : rng.int(10));
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      // Position from the right once the check digit is appended: payload starts at 1.
      let d = digits[digits.length - 1 - i];
      if (i % 2 === 0) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
    }
    digits.push((10 - (sum % 10)) % 10);
    let index = 0;
    return original.replace(/\d/g, () => String(digits[index++]));
  }

  // Keeps the country code and spacing, randomises the account part and
  // recomputes the check digits so the IBAN stays valid.
  private scrambleIban(original: string, rng: KeyedRng): string {
    const compact = original.replace(/\s/g, '').toUpperCase();
    const country = compact.slice(0, 2);
    const bban = compact
      .slice(4)
      .replace(/[0-9]/g, () => String(rng.int(10)))
      .replace(/[A-Z]/g, () => String.fromCharCode(65 + rng.int(26)));
    const check = String(98 - OccultoValidators.ibanRemainder(`${country}00${bban}`)).padStart(2, '0');
    const chars = [...`${country}${check}${bban}`];
    let index = 0;
    return original.replace(/\S/g, () => chars[index++]);
  }

  // Keeps the international/trunk prefix ("+33 ", "06") and separators.
  private scramblePhone(original: string, rng: KeyedRng): string {
    const prefix = original.match(/^\+\d{1,3}(?=[\s.-])|^\+\d{2}|^0\d|^\(/)?.[0] ?? '';
    return prefix + original.slice(prefix.length).replace(/\d/g, () => String(rng.int(10)));
  }

  // Keeps the TLD (and a leading "www"), scrambles the other labels.
  private scrambleDomain(original: string, rng: KeyedRng): string {
    const labels = original.split('.');
    return labels
      .map((label, i) =>
        i === labels.length - 1 || (i === 0 && label.toLowerCase() === 'www') ? label : this.scrambleGenericText(label, rng)
      )
      .join('.');
  }

  // Keeps the scheme, port and URL punctuation; host as a domain, rest generic.
  private scrambleUrl(original: string, rng: KeyedRng): string {
    const match = Scrambler.URL_REGEX.exec(original);
    if (!match) return this.scrambleGenericText(original, rng);
    const [, scheme, authority, rest] = match;
    const [, host, port = ''] = /^([^:]*)(:\d+)?$/.exec(authority) ?? [authority, authority];
    const scrambledHost = Scrambler.IPV4_REGEX.test(host)
      ? this.scrambleIPv4(rng)
      : Scrambler.DOMAIN_REGEX.test(host)
        ? this.scrambleDomain(host, rng)
        : this.scrambleGenericText(host, rng);
    return scheme + scrambledHost + port + this.scrambleGenericText(rest, rng);
  }

  private scrambleGenericText(original: string, rng: KeyedRng): string {
    // Substitute letters (any script) and digits while preserving length in
    // code points, case class, and word structure; keep everything else.
    let result = '';
    for (const ch of original) {
      if (/\p{Lu}/u.test(ch)) {
        result += String.fromCharCode(65 + rng.int(26));
      } else if (/\p{L}/u.test(ch)) {
        result += String.fromCharCode(97 + rng.int(26));
      } else if (/\p{N}/u.test(ch)) {
        result += String.fromCharCode(48 + rng.int(10));
      } else {
        // Preserve spaces, punctuation, and special characters
        result += ch;
      }
    }
    return result;
  }
}

// Global instance for content script usage; ephemeral key until setKey is called.
const occultoScrambler = new Scrambler();
