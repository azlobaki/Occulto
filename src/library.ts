// Ready-made detection patterns, enabled from Settings → Detection → Pattern
// library. Enabling one copies it into config.regex (tagged with `preset`).

interface OccultoPreset {
  id: string;
  category: string;
  name: string;
  description: string;
  pattern: string;
  flags: string;
  validator?: PatternValidator;
  sample: string; // text containing a match
  expect?: string; // the match expected in `sample` (defaults to the whole sample)
  negatives?: string[]; // texts that must not produce a (validated) match
  noisy?: boolean; // can hide harmless text: off by default, flagged in the UI
}

const OCCULTO_PRESETS: OccultoPreset[] = [
  // Contact
  {
    id: 'email',
    category: 'Contact',
    name: 'Email',
    description: 'Email addresses',
    pattern: String.raw`[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}`,
    flags: 'gi',
    sample: 'jane.doe@acme.com',
  },
  {
    id: 'phone-fr',
    category: 'Contact',
    name: 'Phone (FR)',
    description: 'French numbers: 06 12 34 56 78, +33 1 23 45 67 89',
    pattern: String.raw`(?<![\d+])(?:(?:\+|00)33[\s.-]?(?:\(0\)[\s.-]?)?|0)[1-9](?:[\s.-]?\d{2}){4}(?!\d)`,
    flags: 'g',
    sample: '+33 6 12 34 56 78',
    negatives: ['12 34 56 78', '2026-10-09'],
  },
  {
    id: 'phone-intl',
    category: 'Contact',
    name: 'Phone (international)',
    description: 'Numbers written with a +country code',
    pattern: String.raw`(?<![\w+])\+[1-9]\d{0,2}(?:[\s.-]?\(?\d{1,4}\)?){2,5}(?!\d)`,
    flags: 'g',
    sample: '+44 20 7946 0958',
    negatives: ['+3'],
  },
  // Network
  {
    id: 'ipv4',
    category: 'Network',
    name: 'IPv4',
    description: 'IPv4 addresses',
    pattern: String.raw`\b(?:(?:25[0-5]|2[0-4]\d|1?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|1?\d{1,2})\b`,
    flags: 'gi',
    sample: '192.168.1.42',
    negatives: ['999.1.1.1'],
  },
  {
    id: 'ipv6',
    category: 'Network',
    name: 'IPv6',
    description: 'IPv6 addresses, including compressed forms (fe80::1)',
    pattern: CURRENT_IPV6_PATTERN,
    flags: 'gi',
    sample: '2001:db8::ff00:42:8329',
    negatives: ['12:30:45'],
  },
  {
    id: 'mac',
    category: 'Network',
    name: 'MAC address',
    description: '00:1A:2B:3C:4D:5E, 00-1a-…, 001a.2b3c.4d5e',
    pattern: String.raw`(?<![0-9A-Fa-f:-])(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}(?![0-9A-Fa-f:-])|\b[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\b`,
    flags: 'g',
    sample: '00:1A:2B:3C:4D:5E',
    negatives: ['12:30:45', '00:1A:2B:3C:4D'],
  },
  {
    id: 'internal-host',
    category: 'Network',
    name: 'Internal hostname',
    description: 'Names ending in .local, .lan, .internal, .intra, .corp, .home.arpa',
    pattern: String.raw`\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:local|lan|internal|intra|corp|home\.arpa)\b`,
    flags: 'gi',
    sample: 'db01.prod.internal',
    negatives: ['example.com'],
  },
  {
    id: 'domain',
    category: 'Network',
    name: 'Domain name',
    description: 'Domains on common TLDs (.com, .fr, .io…)',
    pattern: String.raw`\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|fr|eu|de|uk|dev|app|cloud|ai|co)\b`,
    flags: 'gi',
    sample: 'api.acme.com',
    negatives: ['config.json'],
    noisy: true,
  },
  {
    id: 'url',
    category: 'Network',
    name: 'URL',
    description: 'Full http(s) links',
    pattern: String.raw`\bhttps?://[^\s<>"']+`,
    flags: 'gi',
    sample: 'https://intranet.acme.com/clients/42',
    noisy: true,
  },
  {
    id: 'url-credentials',
    category: 'Secrets',
    name: 'Password in URL',
    description: 'user:password in https://user:password@host',
    pattern: String.raw`(?<=://)[^/\s:@]+:[^/\s@]+(?=@)`,
    flags: 'g',
    sample: 'https://bob:s3cr3t@git.acme.com/repo',
    expect: 'bob:s3cr3t',
    negatives: ['https://git.acme.com/repo'],
  },
  // Finance
  {
    id: 'iban',
    category: 'Finance',
    name: 'IBAN',
    description: 'Bank account numbers (checksum verified)',
    pattern: String.raw`\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?\b`,
    flags: 'g',
    validator: 'iban',
    sample: 'FR76 3000 6000 0112 3456 7890 189',
    negatives: ['FR76 3000 6000 0112 3456 7890 188'],
  },
  {
    id: 'card',
    category: 'Finance',
    name: 'Payment card',
    description: 'Card numbers (Luhn checksum verified)',
    pattern: String.raw`\b(?:\d{4}[ -]?){3}\d{1,4}\b`,
    flags: 'g',
    validator: 'luhn',
    sample: '4111 1111 1111 1111',
    negatives: ['4111 1111 1111 1112', '1234 5678'],
  },
  // Identity (France)
  {
    id: 'nir',
    category: 'Identity (FR)',
    name: 'Social security no. (NIR)',
    description: 'Numéro de sécurité sociale (key verified when present)',
    pattern: String.raw`\b[12][\s.]?\d{2}[\s.]?(?:0[1-9]|1[0-2]|[2-9]\d)[\s.]?(?:\d{2}|2[AB])[\s.]?\d{3}[\s.]?\d{3}(?:[\s.]?\d{2})?\b`,
    flags: 'g',
    validator: 'nir',
    sample: '2 69 05 49 588 157 80',
    negatives: ['2 69 05 49 588 157 81'],
  },
  {
    id: 'siren-siret',
    category: 'Identity (FR)',
    name: 'SIREN / SIRET',
    description: 'Company identifiers (Luhn verified)',
    pattern: String.raw`\b\d{3}[\s.]?\d{3}[\s.]?\d{3}(?:[\s.]?\d{5})?\b`,
    flags: 'g',
    validator: 'luhn',
    sample: '732 829 320',
    negatives: ['123 456 789'],
    noisy: true,
  },
  {
    id: 'plate-fr',
    category: 'Identity (FR)',
    name: 'Licence plate (FR)',
    description: 'AB-123-CD',
    pattern: String.raw`\b[A-HJ-NP-TV-Z]{2}-\d{3}-[A-HJ-NP-TV-Z]{2}\b`,
    flags: 'g',
    sample: 'AB-123-CD',
    negatives: ['AB-123-IO'],
  },
  {
    id: 'date',
    category: 'Identity (FR)',
    name: 'Date (dd/mm/yyyy)',
    description: 'Dates such as birth dates: 09/10/1985, 31.12.2001',
    pattern: String.raw`\b(?:0[1-9]|[12]\d|3[01])[/.-](?:0[1-9]|1[0-2])[/.-](?:19|20)\d{2}\b`,
    flags: 'g',
    sample: '09/10/1985',
    negatives: ['32/10/1985'],
    noisy: true,
  },
  // Secrets & tokens
  {
    id: 'jwt',
    category: 'Secrets',
    name: 'JWT',
    description: 'JSON Web Tokens (eyJ….eyJ….…)',
    pattern: String.raw`\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{10,}`,
    flags: 'g',
    sample: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop',
  },
  {
    id: 'bearer',
    category: 'Secrets',
    name: 'Bearer token',
    description: 'Authorization: Bearer …',
    pattern: String.raw`\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*`,
    flags: 'g',
    sample: 'Bearer abcdefghijklmnop1234',
    negatives: ['Bearer x'],
  },
  {
    id: 'aws-key',
    category: 'Secrets',
    name: 'AWS access key',
    description: 'AKIA… / ASIA… key ids',
    pattern: String.raw`\b(?:AKIA|ASIA)[A-Z0-9]{16}\b`,
    flags: 'g',
    sample: 'AKIAIOSFODNN7EXAMPLE',
  },
  {
    id: 'aws-arn',
    category: 'Secrets',
    name: 'AWS ARN',
    description: 'arn:aws:…:123456789012:… (reveals account ids)',
    pattern: String.raw`\barn:aws[a-z-]*:[a-z0-9-]+:[a-z0-9-]*:\d{12}:[^\s"']+`,
    flags: 'g',
    sample: 'arn:aws:iam::123456789012:user/bob',
  },
  {
    id: 'github-token',
    category: 'Secrets',
    name: 'GitHub token',
    description: 'ghp_…, gho_…, github_pat_…',
    pattern: String.raw`\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b`,
    flags: 'g',
    sample: ['ghp', 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789'].join('_'),
  },
  {
    id: 'slack-token',
    category: 'Secrets',
    name: 'Slack token',
    description: 'xoxb-…, xoxp-…',
    pattern: String.raw`\bxox[abprs]-[A-Za-z0-9-]{10,}\b`,
    flags: 'g',
    sample: ['xoxb', '123456789012', 'abcdefghij'].join('-'),
  },
  {
    id: 'stripe-key',
    category: 'Secrets',
    name: 'Stripe key',
    description: 'sk_live_…, rk_test_…',
    pattern: String.raw`\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b`,
    flags: 'g',
    // Built at runtime so no key-shaped literal sits in the source (secret scanners).
    sample: ['sk', 'live', 'Abc123'.repeat(4)].join('_'),
  },
  {
    id: 'google-api-key',
    category: 'Secrets',
    name: 'Google API key',
    description: 'AIza…',
    pattern: String.raw`\bAIza[0-9A-Za-z_-]{35}\b`,
    flags: 'g',
    sample: 'AI' + 'za' + 'SyA1234567890abcdefghijklmnopqrstuv',
  },
  {
    id: 'private-key',
    category: 'Secrets',
    name: 'Private key header',
    description: '-----BEGIN … PRIVATE KEY----- lines',
    pattern: String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----`,
    flags: 'g',
    sample: '-----BEGIN RSA PRIVATE KEY-----',
  },
  {
    id: 'hash',
    category: 'Secrets',
    name: 'Hash (MD5/SHA)',
    description: '32, 40 or 64 hex characters (commit ids, checksums…)',
    pattern: String.raw`\b(?:[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{64})\b`,
    flags: 'gi',
    sample: 'd41d8cd98f00b204e9800998ecf8427e',
    noisy: true,
  },
  {
    id: 'uuid',
    category: 'Secrets',
    name: 'UUID',
    description: 'Record / tenant ids such as 123e4567-e89b-12d3-a456-426614174000',
    pattern: String.raw`\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b`,
    flags: 'gi',
    sample: '123e4567-e89b-12d3-a456-426614174000',
    noisy: true,
  },
  // Crypto
  {
    id: 'eth',
    category: 'Crypto',
    name: 'Ethereum address',
    description: '0x followed by 40 hex characters',
    pattern: String.raw`\b0x[a-fA-F0-9]{40}\b`,
    flags: 'g',
    sample: '0x52908400098527886E0F7030069857D2E4169EE7',
  },
  {
    id: 'btc',
    category: 'Crypto',
    name: 'Bitcoin address',
    description: 'Legacy (1…/3…) and bech32 (bc1…) addresses',
    pattern: String.raw`\b(?:bc1[ac-hj-np-z02-9]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b`,
    flags: 'g',
    sample: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
  },
];

class OccultoLibrary {
  static readonly categories = ['Contact', 'Network', 'Finance', 'Identity (FR)', 'Secrets', 'Crypto'];

  static toPattern(preset: OccultoPreset): RegexPattern {
    const pattern: RegexPattern = { name: preset.name, pattern: preset.pattern, flags: preset.flags, preset: preset.id };
    if (preset.validator) pattern.validator = preset.validator;
    return pattern;
  }

  // Older configs carry presets without the tag: an identical pattern counts.
  private static isFrom(entry: RegexPattern, preset: OccultoPreset): boolean {
    return entry.preset === preset.id || entry.pattern === preset.pattern;
  }

  static isEnabled(config: Config, preset: OccultoPreset): boolean {
    return config.regex.some((entry) => OccultoLibrary.isFrom(entry, preset));
  }

  static enable(config: Config, preset: OccultoPreset): Config {
    if (OccultoLibrary.isEnabled(config, preset)) return config;
    return { ...config, regex: [...config.regex, OccultoLibrary.toPattern(preset)] };
  }

  private static compiled: Array<{ preset: OccultoPreset; regex: RegExp }> | null = null;

  // Audit: matches of presets the user has NOT enabled (noisy ones skipped,
  // checksums enforced) — likely sensitive data left visible.
  static findLeaks(text: string, config: Config): Array<{ presetId: string; start: number; end: number }> {
    OccultoLibrary.compiled ??= OCCULTO_PRESETS.filter((p) => !p.noisy).map((preset) => ({
      preset,
      regex: new RegExp(preset.pattern, preset.flags.includes('g') ? preset.flags : preset.flags + 'g'),
    }));
    const leaks: Array<{ presetId: string; start: number; end: number }> = [];
    for (const { preset, regex } of OccultoLibrary.compiled) {
      if (OccultoLibrary.isEnabled(config, preset)) continue;
      regex.lastIndex = 0;
      for (const match of text.matchAll(regex)) {
        if (match[0] === '' || (preset.validator && !OccultoValidators.check(preset.validator, match[0]))) continue;
        leaks.push({ presetId: preset.id, start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
      }
    }
    return leaks.sort((a, b) => a.start - b.start);
  }

  static disable(config: Config, preset: OccultoPreset): Config {
    return { ...config, regex: config.regex.filter((entry) => !OccultoLibrary.isFrom(entry, preset)) };
  }
}
