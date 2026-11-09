/** Deliberately small Excel expression interpreter. Never executes JS or arbitrary Excel functions. */
type Value = string | boolean;
export function evaluateValidationFormula(formula: string, cellValue: (address: string) => string, namedRange: (name: string) => string[] = () => []): string[] {
  if (formula.length > 20000) return [];
  let cursor = 0; let depth = 0;
  const skip = () => { while (/\s/.test(formula[cursor] || '') && cursor < formula.length) cursor++; };
  const atom = (): Value => {
    if (++depth > 100) throw new Error('Formula depth'); skip();
    let value: Value;
    if (formula[cursor] === '"') {
      cursor++; let str = ''; let closed = false;
      while (cursor < formula.length) { if (formula[cursor] === '"') { if (formula[cursor + 1] === '"') { str += '"'; cursor += 2; } else { cursor++; closed = true; break; } } else str += formula[cursor++]; }
      if (!closed) throw new Error('String'); value = str;
    } else {
      const token = formula.slice(cursor).match(/^\$?[A-Za-z_][A-Za-z0-9_.$]*/)?.[0];
      if (!token) throw new Error('Token'); cursor += token.length; skip();
      if (formula[cursor] === '(') {
        cursor++; const args: Value[] = [];
        if (formula[cursor] !== ')') while (true) { args.push(expression()); skip(); if (formula[cursor] !== ',') break; cursor++; }
        if (formula[cursor++] !== ')') throw new Error('Parenthesis');
        switch (token.toUpperCase()) {
          case 'ISBLANK': if (args.length !== 1) throw new Error('Arguments'); value = args[0] === ''; break;
          case 'IF': if (args.length !== 3 || typeof args[0] !== 'boolean') throw new Error('Arguments'); value = args[0] ? args[1] : args[2]; break;
          case 'SUBSTITUTE': if (args.length !== 3 || args.some(a => typeof a !== 'string') || !args[1]) throw new Error('Arguments'); value = String(args[0]).split(String(args[1])).join(String(args[2])); break;
          // Only unwrap INDIRECT to a name; range resolution remains separate and bounded.
          case 'INDIRECT': if (args.length !== 1) throw new Error('Arguments'); value = String(args[0]); break;
          default: throw new Error('Unsupported function');
        }
      } else if (/^\$?[A-Z]{1,3}\$?[1-9]\d*$/.test(token)) value = cellValue(token);
      else value = token;
    }
    depth--; return value;
  };
  const expression = (): Value => {
    let value = atom(); skip();
    while (formula[cursor] === '&') { cursor++; value = String(value) + String(atom()); skip(); }
    return value;
  };
  try { if (formula.startsWith('=')) cursor++; const result = expression(); skip(); return cursor === formula.length && typeof result === 'string' ? namedRange(result) : []; } catch { return []; }
}
