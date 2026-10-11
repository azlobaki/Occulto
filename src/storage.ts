const DEFAULT_SCRAMBLE_SETTINGS: ScrambleSettings = {
  rotateKeyOnStartup: false,
  alwaysScrambleIPv4: false,
  alwaysScrambleIPv6: false,
};

// Previous default IPv6 pattern (matched compressed addresses only partially).
// Stored configs that still carry it exactly are upgraded in loadAll.
const LEGACY_IPV6_PATTERN = "\\b(?:(?:[A-Fa-f0-9]{1,4}:){7}[A-Fa-f0-9]{1,4}|(?:[A-Fa-f0-9]{1,4}:){1,7}:|(?:[A-Fa-f0-9]{1,4}:){1,6}:[A-Fa-f0-9]{1,4}|(?:[A-Fa-f0-9]{1,4}:){1,5}(?::[A-Fa-f0-9]{1,4}){1,2}|(?:[A-Fa-f0-9]{1,4}:){1,4}(?::[A-Fa-f0-9]{1,4}){1,3}|(?:[A-Fa-f0-9]{1,4}:){1,3}(?::[A-Fa-f0-9]{1,4}){1,4}|(?:[A-Fa-f0-9]{1,4}:){1,2}(?::[A-Fa-f0-9]{1,4}){1,5}|[A-Fa-f0-9]{1,4}:(?:(?::[A-Fa-f0-9]{1,4}){1,6})|:(?:(?::[A-Fa-f0-9]{1,4}){1,7}|:)|(?:[A-Fa-f0-9]{1,4}:){6}(?:25[0-5]|2[0-4]\\d|1?\\d{1,2})(?:\\.(?:25[0-5]|2[0-4]\\d|1?\\d{1,2})){3})\\b";
const CURRENT_IPV6_PATTERN = "(?<![A-Fa-f0-9]|[A-Fa-f0-9]:|::)(?:(?:[A-Fa-f0-9]{1,4}:){7}[A-Fa-f0-9]{1,4}|(?:[A-Fa-f0-9]{1,4}:){6}(?:25[0-5]|2[0-4]\\d|1?\\d{1,2})(?:\\.(?:25[0-5]|2[0-4]\\d|1?\\d{1,2})){3}|[A-Fa-f0-9]{1,4}:(?::[A-Fa-f0-9]{1,4}){1,6}|(?:[A-Fa-f0-9]{1,4}:){1,2}(?::[A-Fa-f0-9]{1,4}){1,5}|(?:[A-Fa-f0-9]{1,4}:){1,3}(?::[A-Fa-f0-9]{1,4}){1,4}|(?:[A-Fa-f0-9]{1,4}:){1,4}(?::[A-Fa-f0-9]{1,4}){1,3}|(?:[A-Fa-f0-9]{1,4}:){1,5}(?::[A-Fa-f0-9]{1,4}){1,2}|(?:[A-Fa-f0-9]{1,4}:){1,6}:[A-Fa-f0-9]{1,4}|(?:[A-Fa-f0-9]{1,4}:){1,7}:|:(?:(?::[A-Fa-f0-9]{1,4}){1,7}|:))(?![A-Fa-f0-9]|:[A-Fa-f0-9:])";

class OccultoStorage {
  static readonly SYNC_KEYS: string[] = ['enabled', 'config', 'mode'];

  private static readonly DATA_KEYS: (keyof StorageData)[] = [
    'enabled',
    'config',
    'mode',
    'replaceRules',
    'scrambleKey',
    'scrambleSettings',
    'pausedSites',
    'hideStyle',
    'profiles',
    'activeProfileId',
  ];

  static readonly PROFILE_KEYS: (keyof OccultoProfileData)[] = [
    'replaceRules',
    'config',
    'mode',
    'hideStyle',
    'scrambleSettings',
  ];

  static generateScrambleKey(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  static async migrateFromSync(): Promise<void> {
    const flag = await chrome.storage.local.get('migratedFromSync');
    if (flag.migratedFromSync === true) return;
    try {
      const synced = await chrome.storage.sync.get(OccultoStorage.SYNC_KEYS);
      const localValues = await chrome.storage.local.get(OccultoStorage.SYNC_KEYS);
      const toCopy: Record<string, unknown> = {};
      for (const key of OccultoStorage.SYNC_KEYS) {
        if (synced[key] !== undefined && localValues[key] === undefined) {
          toCopy[key] = synced[key];
        }
      }
      if (Object.keys(toCopy).length > 0) {
        await chrome.storage.local.set(toCopy);
      }
      await chrome.storage.sync.remove(OccultoStorage.SYNC_KEYS);
      await chrome.storage.local.set({ migratedFromSync: true });
    } catch (err) {
      console.error(
        '[Occulto] Failed to migrate settings from sync storage; will retry on next start',
        err
      );
    }
  }

  static async loadDefaultConfig(): Promise<Config> {
    const response = await fetch(chrome.runtime.getURL('config.json'));
    return (await response.json()) as Config;
  }

  static async ensureScrambleKey(): Promise<string> {
    const stored = await chrome.storage.local.get('scrambleKey');
    if (typeof stored.scrambleKey === 'string' && /^[0-9a-f]{64}$/.test(stored.scrambleKey)) {
      return stored.scrambleKey;
    }
    return OccultoStorage.resetScrambleKey();
  }

  static async resetScrambleKey(): Promise<string> {
    const scrambleKey = OccultoStorage.generateScrambleKey();
    await chrome.storage.local.set({ scrambleKey });
    return scrambleKey;
  }

  static async loadAll(): Promise<StorageData> {
    await OccultoStorage.migrateFromSync();
    const stored: Record<string, unknown> = await chrome.storage.local.get(
      OccultoStorage.DATA_KEYS
    );

    let config = stored.config as Config | undefined;
    if (!config) {
      config = await OccultoStorage.loadDefaultConfig();
      // Persist the default only once the sync migration has completed;
      // otherwise a later migration retry would be shadowed by (or drop) the
      // user's synced config.
      const flag = await chrome.storage.local.get('migratedFromSync');
      if (flag.migratedFromSync === true) await OccultoStorage.save({ config });
    } else if (OccultoStorage.upgradeLegacyIPv6Pattern(config)) {
      await OccultoStorage.save({ config });
    }

    return {
      enabled: typeof stored.enabled === 'boolean' ? stored.enabled : true,
      mode: stored.mode === 'scramble' ? 'scramble' : 'blur',
      replaceRules: Array.isArray(stored.replaceRules)
        ? stored.replaceRules
            .map((raw: unknown) => OccultoStorage.normalizeReplaceRule(raw))
            .filter((rule): rule is ReplaceRule => rule !== null)
        : [],
      config,
      scrambleKey: await OccultoStorage.ensureScrambleKey(),
      scrambleSettings: OccultoStorage.normalizeScrambleSettings(stored.scrambleSettings),
      pausedSites: OccultoStorage.normalizePausedSites(stored.pausedSites),
      hideStyle: OccultoStorage.normalizeHideStyle(stored.hideStyle),
      ...OccultoStorage.normalizeProfiles(stored.profiles, stored.activeProfileId),
    };
  }

  // Returns true if any entry was upgraded (config is modified in place).
  private static upgradeLegacyIPv6Pattern(config: Config): boolean {
    let changed = false;
    if (!Array.isArray(config.regex)) return false;
    for (const entry of config.regex) {
      if (entry && entry.pattern === LEGACY_IPV6_PATTERN) {
        entry.pattern = CURRENT_IPV6_PATTERN;
        changed = true;
      }
    }
    return changed;
  }

  static async save(partial: Partial<StorageData>): Promise<void> {
    await chrome.storage.local.set(partial);
  }

  static createReplaceRule(partial: Partial<ReplaceRule> = {}): ReplaceRule {
    return {
      find: '',
      replace: '',
      caseSensitive: false,
      wholeWord: false,
      isRegex: false,
      enabled: true,
      ...partial,
      id: partial.id ?? crypto.randomUUID(),
    };
  }

  static normalizeReplaceRule(raw: unknown): ReplaceRule | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const rule = raw as Record<string, unknown>;
    if (typeof rule.find !== 'string') return null;
    return OccultoStorage.createReplaceRule({
      id: typeof rule.id === 'string' ? rule.id : undefined,
      find: rule.find,
      replace: typeof rule.replace === 'string' ? rule.replace : '',
      caseSensitive: rule.caseSensitive === true,
      wholeWord: rule.wholeWord === true,
      isRegex: rule.isRegex === true,
      enabled: typeof rule.enabled === 'boolean' ? rule.enabled : true,
    });
  }

  static normalizeScrambleSettings(raw: unknown): ScrambleSettings {
    const settings = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<
      string,
      unknown
    >;
    return {
      rotateKeyOnStartup:
        typeof settings.rotateKeyOnStartup === 'boolean'
          ? settings.rotateKeyOnStartup
          : DEFAULT_SCRAMBLE_SETTINGS.rotateKeyOnStartup,
      alwaysScrambleIPv4:
        typeof settings.alwaysScrambleIPv4 === 'boolean'
          ? settings.alwaysScrambleIPv4
          : DEFAULT_SCRAMBLE_SETTINGS.alwaysScrambleIPv4,
      alwaysScrambleIPv6:
        typeof settings.alwaysScrambleIPv6 === 'boolean'
          ? settings.alwaysScrambleIPv6
          : DEFAULT_SCRAMBLE_SETTINGS.alwaysScrambleIPv6,
    };
  }

  static normalizeProfiles(
    rawProfiles: unknown,
    rawActive: unknown
  ): { profiles: OccultoProfile[]; activeProfileId: string | null } {
    const profiles = (Array.isArray(rawProfiles) ? rawProfiles : [])
      .filter(
        (p): p is OccultoProfile =>
          typeof p === 'object' && p !== null && typeof p.id === 'string' && typeof p.name === 'string'
      )
      .map((p) => ({ id: p.id, name: p.name, data: typeof p.data === 'object' && p.data !== null ? p.data : {} }));
    const activeProfileId =
      typeof rawActive === 'string' && profiles.some((p) => p.id === rawActive) ? rawActive : null;
    return { profiles, activeProfileId };
  }

  private static async readProfileState(): Promise<{
    live: Partial<OccultoProfileData>;
    profiles: OccultoProfile[];
    activeProfileId: string | null;
  }> {
    // Normalized values (defaults included) so a snapshot is always complete.
    const data = await OccultoStorage.loadAll();
    const live: OccultoProfileData = {
      replaceRules: data.replaceRules,
      config: data.config,
      mode: data.mode,
      hideStyle: data.hideStyle,
      scrambleSettings: data.scrambleSettings,
    };
    return { live, profiles: data.profiles, activeProfileId: data.activeProfileId };
  }

  // Snapshots the current settings as a new profile and makes it active.
  static async saveCurrentAsProfile(name: string): Promise<string> {
    const { live, profiles } = await OccultoStorage.readProfileState();
    const id = crypto.randomUUID();
    await chrome.storage.local.set({
      profiles: [...profiles, { id, name: name.trim() || 'Profile', data: live }],
      activeProfileId: id,
    });
    return id;
  }

  // Saves the current settings into the active profile, then loads the target's.
  static async switchProfile(targetId: string): Promise<void> {
    const { live, profiles, activeProfileId } = await OccultoStorage.readProfileState();
    const target = profiles.find((p) => p.id === targetId);
    if (!target) throw new Error('Unknown profile');
    const updated = profiles.map((p) => (p.id === activeProfileId ? { ...p, data: live } : p));
    await chrome.storage.local.set({
      ...target.data,
      profiles: updated,
      activeProfileId: targetId,
    });
  }

  static normalizeHideStyle(raw: unknown): HideStyle {
    return raw === 'bar' ? 'bar' : 'blur';
  }

  static normalizePausedSites(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const hosts = raw
      .filter((h): h is string => typeof h === 'string')
      .map((h) => h.trim().toLowerCase())
      .filter((h) => h !== '');
    return [...new Set(hosts)];
  }

  // Hostname used as the per-site pause key; null where content scripts don't run.
  static siteKey(url: string | undefined): string | null {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.hostname.toLowerCase() : null;
    } catch {
      return null;
    }
  }
}
