/** Deliberately small Excel expression interpreter. Never executes JS or arbitrary Excel functions. */
type Value = string | boolean | number;
export function evaluateValidationFormula(formula: string, cellValue: (address: string) => string, namedRange: (name: string) => string[] = () => []): string[] {
  if (formula.length > 20000) return [];
  let cursor = 0; let depth = 0;
  const skip = () => { while (/\s/.test(formula[cursor] || '') && cursor < formula.length) cursor++; };
  const atom = (): Value => {
    if (++depth > 100) throw new Error('Formula depth'); skip();
    let value: Value;
    if (formula[cursor] === '(') {
      cursor++;
      value = expression();
      if (formula[cursor++] !== ')') throw new Error('Parenthesis');
    } else if (formula[cursor] === '"') {
      cursor++; let str = ''; let closed = false;
      while (cursor < formula.length) { if (formula[cursor] === '"') { if (formula[cursor + 1] === '"') { str += '"'; cursor += 2; } else { cursor++; closed = true; break; } } else str += formula[cursor++]; }
      if (!closed) throw new Error('String'); value = str;
    } else if (/\d/.test(formula[cursor] || '')) {
      const token = formula.slice(cursor).match(/^\d+/)![0];
      cursor += token.length;
      value = Number(token);
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
          case 'LEN': if (args.length !== 1) throw new Error('Arguments'); value = String(args[0]).length; break;
          case 'SUBSTITUTE': {
            const [text, search, replacement, occurrence] = args;
            if (args.length < 3 || args.length > 4 || typeof text !== 'string' || typeof search !== 'string' ||
                typeof replacement !== 'string' || !search) throw new Error('Arguments');
            const parts = text.split(search);
            if (occurrence === undefined) value = parts.join(replacement);
            else if (typeof occurrence === 'number' && Number.isSafeInteger(occurrence) && occurrence > 0)
              value = occurrence < parts.length ? parts.slice(0, occurrence).join(search) + replacement + parts.slice(occurrence).join(search) : text;
            else throw new Error('Arguments');
            break;
          }
          case 'FIND': {
            const [search, text, start = 1] = args;
            if (args.length < 2 || args.length > 3 || typeof start !== 'number' || start < 1) throw new Error('Arguments');
            // Excel's IF evaluates the selected branch. NaN propagates an invalid lookup
            // when the expression uses it, while allowing a valid other branch.
            const index = String(text).indexOf(String(search), start - 1);
            value = index < 0 ? NaN : index + 1;
            break;
          }
          case 'MID': {
            const [text, start, length] = args;
            if (args.length !== 3 || typeof start !== 'number' || typeof length !== 'number') throw new Error('Arguments');
            value = start > 0 && length >= 0 ? String(text).slice(start - 1, start - 1 + length) : '';
            break;
          }
          // Only unwrap INDIRECT to a name; range resolution remains separate and bounded.
          case 'INDIRECT': if (args.length !== 1) throw new Error('Arguments'); value = String(args[0]); break;
          default: throw new Error('Unsupported function');
        }
      } else if (/^\$?[A-Z]{1,3}\$?[1-9]\d*$/.test(token)) value = cellValue(token);
      else value = token;
    }
    depth--; return value;
  };
  const arithmetic = (): Value => {
    let value = atom(); skip();
    while (formula[cursor] === '+' || formula[cursor] === '-') {
      const operation = formula[cursor++];
      const right = atom();
      if (typeof value !== 'number' || typeof right !== 'number') throw new Error('Arithmetic');
      value = operation === '+' ? value + right : value - right;
      skip();
    }
    return value;
  };
  const concatenate = (): Value => {
    let value = arithmetic();
    while (formula[cursor] === '&') { cursor++; value = String(value) + String(arithmetic()); }
    return value;
  };
  const expression = (): Value => {
    const left = concatenate();
    if (formula[cursor] !== '=') return left;
    cursor++;
    return left === concatenate();
  };
  try { if (formula.startsWith('=')) cursor++; const result = expression(); skip(); return cursor === formula.length && typeof result === 'string' ? namedRange(result) : []; } catch { return []; }
}
