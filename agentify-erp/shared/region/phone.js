// Phone numbers. `key()` is the identity used to match "the same number written differently". For Pakistan it is the
// last 10 digits (0300-5551350 = +92 300 5551350), exactly as before; other regions use the national significant number.
export function createPhone({ calling_code = '92', trunk = '0', match_tail = 10, national_length = [10] } = {}) {
  const digits = (s) => String(s ?? '').replace(/\D/g, '');
  const maxLen = Math.max(...national_length);
  const national = (input) => {
    let d = digits(input);
    const plus = String(input ?? '').trim().startsWith('+');
    if ((plus || d.length > maxLen) && d.startsWith(calling_code)) d = d.slice(calling_code.length);
    if (trunk && d.startsWith(trunk)) d = d.slice(trunk.length);
    return d;
  };
  return {
    calling_code, digits, national,
    /** Matching key. With match_tail: the last N digits (legacy Pakistan behaviour). */
    key(input) { const d = digits(input); if (match_tail) return d.length >= match_tail ? d.slice(-match_tail) : d; return national(input); },
    /** "+923005551350" style, or null when it cannot be a valid number for this region. */
    e164(input) { const n = national(input); return national_length.includes(n.length) ? `+${calling_code}${n}` : null; },
    valid(input) { return national_length.includes(national(input).length); },
    /** Compact display: +92 300 5551350. */
    display(input) { const n = national(input); return n ? `+${calling_code} ${n.length === 10 ? `${n.slice(0, 3)} ${n.slice(3)}` : n}` : ''; },
    same(a, b) { const x = this.key(a), y = this.key(b); return !!x && x === y; },
  };
}
