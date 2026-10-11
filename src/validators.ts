// Checksum validators that confirm a regex match is real (drops false positives).

class OccultoValidators {
  static check(name: string, text: string): boolean {
    switch (name) {
      case 'luhn':
        return OccultoValidators.luhn(text);
      case 'iban':
        return OccultoValidators.iban(text);
      case 'nir':
        return OccultoValidators.nir(text);
      default:
        return true;
    }
  }

  // Cards, SIREN, SIRET.
  static luhn(text: string): boolean {
    const digits = text.replace(/\D/g, '');
    if (digits.length < 9) return false;
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = Number(digits[digits.length - 1 - i]);
      if (i % 2 === 1) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
    }
    return sum % 10 === 0;
  }

  static ibanRemainder(text: string): number {
    const iban = text.replace(/\s/g, '').toUpperCase();
    const rearranged = iban.slice(4) + iban.slice(0, 4);
    let remainder = 0;
    for (const ch of rearranged) {
      const value = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
      for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
    }
    return remainder;
  }

  static iban(text: string): boolean {
    const iban = text.replace(/\s/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
    return OccultoValidators.ibanRemainder(iban) === 1;
  }

  // French social security number: key = 97 - (13 first digits mod 97);
  // Corsica 2A/2B count as 19/18. Without a key only the format is checked.
  static nir(text: string): boolean {
    const raw = text.replace(/[\s.]/g, '').toUpperCase();
    if (!/^[12]\d{4}(?:\d{2}|2A|2B)\d{6}(?:\d{2})?$/.test(raw)) return false;
    if (raw.length === 13) return true;
    const body = raw.slice(0, 13).replace('2A', '19').replace('2B', '18');
    const key = Number(raw.slice(13));
    return 97 - (Number(body) % 97) === key;
  }
}
