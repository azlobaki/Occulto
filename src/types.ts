type PatternValidator = 'luhn' | 'iban' | 'nir';

interface RegexPattern {
  pattern: string;
  flags?: string;
  name?: string; // optional label shown in the UI
  validator?: PatternValidator; // checksum a match must pass (drops false positives)
  preset?: string; // id of the library preset it came from
}

interface Config {
  version: string;
  selectors: string[];
  regex: RegexPattern[];
  ignore?: {
    selectors?: string[];
    regex?: RegexPattern[];
  };
}

type OccultoMode = 'blur' | 'scramble';

// How hidden (non-scrambled) content looks: blurred, or a solid bar.
type HideStyle = 'blur' | 'bar';

interface ReplaceRule {
  id: string;
  find: string;
  replace: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  isRegex: boolean;
  enabled: boolean;
}

interface ScrambleSettings {
  rotateKeyOnStartup: boolean;
  alwaysScrambleIPv4: boolean;
  alwaysScrambleIPv6: boolean;
}

interface StorageData {
  enabled: boolean;
  config: Config;
  mode: OccultoMode;
  replaceRules: ReplaceRule[];
  scrambleKey: string; // 64 lowercase hex chars (32 bytes)
  scrambleSettings: ScrambleSettings;
  pausedSites: string[]; // lowercase hostnames where Occulto is paused
  hideStyle: HideStyle;
  profiles: OccultoProfile[];
  activeProfileId: string | null;
}

// Settings captured by a profile (everything except the key, pause list and on/off).
interface OccultoProfileData {
  replaceRules: ReplaceRule[];
  config: Config;
  mode: OccultoMode;
  hideStyle: HideStyle;
  scrambleSettings: ScrambleSettings;
}

interface OccultoProfile {
  id: string;
  name: string;
  data: Partial<OccultoProfileData>;
}

interface ReplaceMatch {
  start: number;
  end: number;
  replacement: string;
  ruleId: string;
}

interface TextRange {
  start: number;
  end: number;
  source?: number; // index of the detection regex that produced it
}

type FragmentKind = 'plain' | 'censored' | 'replaced';

interface TextFragment {
  text: string;
  kind: FragmentKind;
  replacement?: string; // set when kind === 'replaced'
  ruleId?: string; // set when kind === 'replaced'
  sources?: number[]; // set when kind === 'censored'
}

type RenderedKind = 'plain' | 'blurred' | 'scrambled' | 'replaced';

interface RenderedFragment {
  kind: RenderedKind;
  original: string;
  display: string;
  ruleId?: string; // replace rule that produced it
  patterns?: number[]; // detection regexes (compiled indexes) that matched it
  forced?: boolean; // scrambled by an IP override while in blur mode
}
