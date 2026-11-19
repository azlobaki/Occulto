// Tab rotation (dashboard carousel): pure helpers shared by the background
// script, the popup and the options page.

interface RotationTab {
  id?: number;
  index: number;
  active: boolean;
}

class OccultoRotation {
  static readonly ALARM = 'occulto-rotate';

  // Id of the tab to show after the active one (wraps around); null when
  // there is nothing to rotate to.
  static nextTabId(tabs: RotationTab[]): number | null {
    const ordered = tabs.filter((tab) => tab.id !== undefined).sort((a, b) => a.index - b.index);
    if (ordered.length < 2) return null;
    const current = ordered.findIndex((tab) => tab.active);
    return ordered[(current + 1) % ordered.length].id ?? null;
  }

  // "45 s", "1 min", "1 min 30 s", "2 h"
  static formatInterval(seconds: number): string {
    const parts: string[] = [];
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    if (hours) parts.push(`${hours} h`);
    if (minutes) parts.push(`${minutes} min`);
    if (rest || parts.length === 0) parts.push(`${rest} s`);
    return parts.join(' ');
  }
}
