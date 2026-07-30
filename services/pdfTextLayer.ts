/**
 * Extragere text din text layer-ul unui PDF — parser pur, fără dependențe Expo.
 *
 * Rulează identic în app (Hermes) și în Node (`npm run parse:pdf`), ca să putem
 * verifica parserul pe PDF-uri reale fără să le commitem.
 *
 * Suportă: FlateDecode, ASCII85, text necomprimat, UTF-16BE, Windows-1252,
 * fonturi cu encoding custom (ToUnicode CMap).
 *
 * Spre deosebire de o extragere „doar text", urmărim și operatorii de
 * poziționare (`Tm`, `Td`, `TD`, `T*`, `TL`) ca să reconstituim liniile în
 * ordinea de citire — extrasele bancare sunt tabele, iar un parser pe linii are
 * nevoie de linii reale, nu de un flux de cuvinte lipite.
 */

import pako from 'pako';

export type GlyphMap = Map<number, string>;

export interface PositionedSpan {
  x: number;
  /** Mărimea efectivă a fontului (Tf × scala din Tm) — folosită la separarea coloanelor. */
  size: number;
  text: string;
}

export interface PositionedLine {
  y: number;
  spans: PositionedSpan[];
}

/** Span-urile cu y mai apropiat de atât aparțin aceleiași linii vizuale. */
const Y_TOLERANCE = 2;

/** Lățime medie estimată a unei glife, ca fracțiune din mărimea fontului. */
const AVG_GLYPH_RATIO = 0.5;

// ─── API principal ────────────────────────────────────────────────────────────

/**
 * Decodează text layer-ul unui PDF (base64) în linii separate prin `\n`.
 * Întoarce șir gol dacă PDF-ul nu are text layer utilizabil.
 */
export function parsePdf(base64: string): string {
  const raw = atob(base64);
  const objMap = buildObjMap(raw);
  const toUniObjs = buildToUnicodeMaps(raw, objMap);
  const fontGlyphMaps = buildFontGlyphMaps(objMap, toUniObjs);

  const lines: string[] = [];
  for (const content of iterateContentStreams(raw)) {
    // Stream-urile se procesează în ordinea din document (= ordinea paginilor);
    // sortarea după y e locală fiecărei pagini.
    lines.push(...linesToText(parseContentStreamPositioned(content, fontGlyphMaps)));
  }

  return lines.join('\n').trim();
}

/**
 * Numără paginile din PDF (base64). Folosit ca să putem avertiza când OCR-ul
 * procesează doar o parte din document.
 */
export function countPdfPages(base64: string): number {
  const raw = atob(base64);
  const pageObjects = raw.match(/\/Type\s*\/Page(?![a-zA-Z])/g);
  if (pageObjects && pageObjects.length > 0) return pageObjects.length;
  const count = /\/Type\s*\/Pages[\s\S]{0,400}?\/Count\s+(\d+)/.exec(raw);
  return count ? parseInt(count[1], 10) : 0;
}

/**
 * Quality gate: decide dacă textul extras din text layer e utilizabil sau
 * trebuie să cădem pe OCR. Cerem structură minimă (linii) și conținut de extras
 * (sume sau date), nu doar volum de caractere.
 */
export function isUsableExtraction(text: string): boolean {
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 10) return false;
  const dataLines = lines.filter(l => AMOUNT_HINT.test(l) || DATE_HINT.test(l));
  return dataLines.length >= 3;
}

const AMOUNT_HINT = /\d[\d.,]*[.,]\d{2}/;
const DATE_HINT = /\d{2}[./-]\d{2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2}/;

export function isPdfFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.pdf');
}

// ─── Content stream → linii poziționate ───────────────────────────────────────

/**
 * Operatorii dintr-un content stream, în ordinea în care îi tratăm.
 * `Tc/Tw/Tz/Ts/Tr` sunt irelevante pentru ordinea liniilor și le ignorăm.
 */
const OP_RE = new RegExp(
  [
    /\/([^\s/[\]<>(){}]+)\s+([\d.]+)\s+Tf/, // 1 nume font, 2 mărime
    /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm/, // 3..8
    /(-?[\d.]+)\s+(-?[\d.]+)\s+(TD|Td)/, // 9 tx, 10 ty, 11 operator
    /(-?[\d.]+)\s+TL/, // 12 leading
    /T\*/,
    /(-?[\d.]+)\s+(-?[\d.]+)\s+\(((?:[^()\\]|\\.)*)\)\s*"/, // 13,14 spațieri, 15 text
    /\(((?:[^()\\]|\\.)*)\)\s*(Tj|')/, // 16 text, 17 operator
    /<([0-9a-fA-F]*)>\s*(Tj|')/, // 18 hex, 19 operator
    /\[([\s\S]{0,5000}?)\]\s*TJ/, // 20 array
    /\bBT\b/,
    /\bET\b/,
  ]
    .map(re => re.source)
    .join('|'),
  'g'
);

const IDENTITY: readonly number[] = [1, 0, 0, 1, 0, 0];

/** Înmulțire de matrici PDF 3×2 (`m1 × m2`). */
function multiply(m1: readonly number[], m2: readonly number[]): number[] {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

/**
 * Parsează un content stream și întoarce liniile vizuale, sortate descrescător
 * după y, cu span-urile fiecărei linii sortate crescător după x.
 *
 * Nu calculăm lățimi de glife: un operator de text = un span. Ordinea și
 * gruparea pe linii sunt suficiente pentru un parser de extras.
 */
export function parseContentStreamPositioned(
  content: string,
  fontMaps: Map<string, GlyphMap>
): PositionedLine[] {
  const spans: { x: number; y: number; size: number; text: string }[] = [];

  let textMatrix = [...IDENTITY];
  let lineMatrix = [...IDENTITY];
  let leading = 0;
  let fontSize = 0;
  let glyphMap: GlyphMap | null = null;

  const nextLine = (tx: number, ty: number) => {
    lineMatrix = multiply([1, 0, 0, 1, tx, ty], lineMatrix);
    textMatrix = [...lineMatrix];
  };

  const emit = (text: string) => {
    if (!text) return;
    const size = fontSize * Math.hypot(textMatrix[0], textMatrix[1]);
    spans.push({ x: textMatrix[4], y: textMatrix[5], size, text });
  };

  OP_RE.lastIndex = 0;
  let op: RegExpExecArray | null;
  while ((op = OP_RE.exec(content)) !== null) {
    if (op[1] !== undefined) {
      glyphMap = fontMaps.get(op[1]) ?? null;
      fontSize = parseFloat(op[2]);
    } else if (op[3] !== undefined) {
      lineMatrix = [3, 4, 5, 6, 7, 8].map(i => parseFloat(op![i]));
      textMatrix = [...lineMatrix];
    } else if (op[9] !== undefined) {
      const ty = parseFloat(op[10]);
      if (op[11] === 'TD') leading = -ty;
      nextLine(parseFloat(op[9]), ty);
    } else if (op[12] !== undefined) {
      leading = parseFloat(op[12]);
    } else if (op[0] === 'T*') {
      nextLine(0, -leading);
    } else if (op[15] !== undefined) {
      nextLine(0, -leading);
      emit(decodeStr(op[15], glyphMap));
    } else if (op[16] !== undefined) {
      if (op[17] === "'") nextLine(0, -leading);
      emit(decodeStr(op[16], glyphMap));
    } else if (op[18] !== undefined) {
      if (op[19] === "'") nextLine(0, -leading);
      emit(decodeHexStr(op[18], glyphMap));
    } else if (op[20] !== undefined) {
      // Un array TJ = un singur span; numerele sunt kerning, nu spații.
      const partRe = /\(((?:[^()\\]|\\.)*)\)|<([0-9a-fA-F]*)>/g;
      let part: RegExpExecArray | null;
      let text = '';
      while ((part = partRe.exec(op[20])) !== null) {
        text +=
          part[1] !== undefined ? decodeStr(part[1], glyphMap) : decodeHexStr(part[2], glyphMap);
      }
      emit(text);
    } else if (op[0] === 'BT') {
      textMatrix = [...IDENTITY];
      lineMatrix = [...IDENTITY];
    }
    // `ET` nu schimbă starea — o resetăm la următorul `BT`.
  }

  const lines: PositionedLine[] = [];
  for (const span of [...spans].sort((a, b) => b.y - a.y)) {
    const current = lines[lines.length - 1];
    if (current && current.y - span.y <= Y_TOLERANCE) {
      current.spans.push({ x: span.x, size: span.size, text: span.text });
    } else {
      lines.push({ y: span.y, spans: [{ x: span.x, size: span.size, text: span.text }] });
    }
  }
  for (const line of lines) line.spans.sort((a, b) => a.x - b.x);
  return lines;
}

/**
 * Serializează liniile vizuale în linii de text.
 *
 * O linie vizuală poate conține mai multe coloane de tabel (descriere, debit,
 * credit). Le separăm în linii distincte când distanța până la span-ul următor
 * depășește clar sfârșitul estimat al textului precedent — altfel suma din
 * coloana „Debit" ar ajunge lipită de descriere și n-ar mai putea fi
 * deosebită de cifrele din interiorul descrierii („valoare tranzactie: 290.00").
 */
export function linesToText(lines: PositionedLine[]): string[] {
  const out: string[] = [];

  const flush = (parts: string[]) => {
    const text = parts
      .join(' ')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
    if (text) out.push(text);
  };

  for (const line of lines) {
    let parts: string[] = [];
    let prevEnd = Number.NEGATIVE_INFINITY;
    let prevSize = 0;
    for (const span of line.spans) {
      if (parts.length > 0 && span.x - prevEnd > Math.max(6, prevSize * 2)) {
        flush(parts);
        parts = [];
      }
      parts.push(span.text);
      prevEnd = span.x + span.text.length * span.size * AVG_GLYPH_RATIO;
      prevSize = span.size;
    }
    flush(parts);
  }

  return out;
}

// ─── Iterare stream-uri de conținut ───────────────────────────────────────────

function* iterateContentStreams(raw: string): Generator<string> {
  let pos = 0;
  while (pos < raw.length) {
    // Găsim keyword-ul "stream" — poate fi precedat de \n, \r\n sau direct de >>
    let streamPos = -1;
    let searchPos = pos;
    while (searchPos < raw.length) {
      const idx = raw.indexOf('stream', searchPos);
      if (idx === -1) break;
      if (idx >= 3 && raw.slice(idx - 3, idx) === 'end') {
        searchPos = idx + 6;
        continue;
      }
      const c = raw[idx + 6];
      if (c === '\r' || c === '\n') {
        streamPos = idx;
        break;
      }
      searchPos = idx + 1;
    }
    if (streamPos === -1) return;

    let dataStart = streamPos + 6; // sare peste 'stream'
    if (raw[dataStart] === '\r') dataStart++;
    if (raw[dataStart] === '\n') {
      dataStart++;
    } else {
      pos = streamPos + 1;
      continue;
    }

    const dictEnd = raw.lastIndexOf('>>', streamPos);
    if (dictEnd === -1) {
      pos = streamPos + 1;
      continue;
    }
    const dictStart = raw.lastIndexOf('<<', dictEnd);
    if (dictStart === -1) {
      pos = streamPos + 1;
      continue;
    }
    const dict = raw.slice(dictStart, dictEnd + 2);

    // Ignorăm stream-uri non-text (xref, imagini, metadate, programe de font)
    if (/\/Type\s*\/XRef|\/Subtype\s*\/Image|\/Type\s*\/Metadata|\/Length1\b/.test(dict)) {
      pos = streamPos + 1;
      continue;
    }

    const esPos = raw.indexOf('endstream', dataStart);
    if (esPos === -1) return;

    let streamEnd = esPos;
    const lenMatch = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    if (lenMatch) {
      const length = parseInt(lenMatch[1], 10);
      if (length > 10 && dataStart + length <= raw.length) streamEnd = dataStart + length;
    }

    const hasFlateDecode = /\/FlateDecode\b|\/Fl\b/.test(dict);
    const hasAscii85 = /\/ASCII85Decode\b|\/A85\b/.test(dict);
    const hasFilter = /\/Filter\b/.test(dict);
    const streamStr = raw.slice(dataStart, streamEnd);

    let content: string | null = null;
    try {
      if (hasAscii85) {
        const decoded = decodeAscii85(streamStr);
        content = bytesToStr(hasFlateDecode ? pako.inflate(decoded) : decoded);
      } else if (hasFlateDecode) {
        content = bytesToStr(pako.inflate(strToBytes(streamStr)));
      } else if (!hasFilter) {
        content = streamStr;
      }
    } catch {
      content = null; // stream corupt sau filtru nesuportat
    }

    if (content) yield content;
    pos = streamEnd + 1;
  }
}

// ─── Construire hartă obiecte ─────────────────────────────────────────────────

function buildObjMap(raw: string): Map<number, string> {
  const map = new Map<number, string>();
  const re = /(\d+)\s+0\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const num = parseInt(m[1], 10);
    const endPos = raw.indexOf('endobj', m.index);
    if (endPos !== -1) {
      map.set(num, raw.slice(m.index, endPos));
    }
  }
  return map;
}

// ─── Parsare ToUnicode CMap ───────────────────────────────────────────────────

export function parseToUnicodeCMap(content: string): GlyphMap {
  const map: GlyphMap = new Map();

  // beginbfchar: <glyphCode> <unicodeHex>
  const bfcharRe = /beginbfchar([\s\S]*?)endbfchar/g;
  let bfc: RegExpExecArray | null;
  while ((bfc = bfcharRe.exec(content)) !== null) {
    const entryRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let entry: RegExpExecArray | null;
    while ((entry = entryRe.exec(bfc[1])) !== null) {
      const glyph = parseInt(entry[1], 16);
      const unicode = parseUnicodeHex(entry[2]);
      if (unicode) map.set(glyph, unicode);
    }
  }

  // beginbfrange: <start> <end> <unicodeStart>
  const bfrangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
  let bfr: RegExpExecArray | null;
  while ((bfr = bfrangeRe.exec(content)) !== null) {
    const entryRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let entry: RegExpExecArray | null;
    while ((entry = entryRe.exec(bfr[1])) !== null) {
      const start = parseInt(entry[1], 16);
      const end = parseInt(entry[2], 16);
      let uniCode = parseInt(entry[3], 16);
      for (let g = start; g <= end; g++) {
        map.set(g, String.fromCodePoint(uniCode++));
      }
    }
  }

  return map;
}

function parseUnicodeHex(hex: string): string {
  // Poate fi un codepoint sau o secvență (surrogate pairs etc.)
  if (hex.length <= 4) {
    return String.fromCodePoint(parseInt(hex, 16));
  }
  let result = '';
  for (let i = 0; i < hex.length; i += 4) {
    result += String.fromCodePoint(parseInt(hex.slice(i, i + 4), 16));
  }
  return result;
}

// ─── Construire hărți ToUnicode pentru obiecte ────────────────────────────────

function buildToUnicodeMaps(raw: string, objMap: Map<number, string>): Map<number, GlyphMap> {
  const maps = new Map<number, GlyphMap>();

  // Colectăm toate numerele de obiecte ToUnicode referențiate din fonturi
  const toUniNums = new Set<number>();
  for (const content of objMap.values()) {
    const tuMatch = /\/ToUnicode\s+(\d+)\s+0\s+R/g;
    let m: RegExpExecArray | null;
    while ((m = tuMatch.exec(content)) !== null) {
      toUniNums.add(parseInt(m[1], 10));
    }
    const fdRe = /\/Font\s*<<([\s\S]{1,2000}?)>>/g;
    let fd: RegExpExecArray | null;
    while ((fd = fdRe.exec(content)) !== null) {
      const refRe = /\/\S+\s+(\d+)\s+0\s+R/g;
      let ref: RegExpExecArray | null;
      while ((ref = refRe.exec(fd[1])) !== null) {
        const fontContent = objMap.get(parseInt(ref[1], 10));
        if (!fontContent) continue;
        const tu2 = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(fontContent);
        if (tu2) toUniNums.add(parseInt(tu2[1], 10));
      }
    }
  }

  // Decomprimăm și parsăm fiecare obiect ToUnicode
  for (const objNum of toUniNums) {
    const objRe = new RegExp(`\\b${objNum}\\s+0\\s+obj\\b`);
    const objMatch = objRe.exec(raw);
    if (!objMatch) continue;

    const objEnd = raw.indexOf('endobj', objMatch.index);
    const objContent = raw.slice(objMatch.index, objEnd === -1 ? undefined : objEnd);

    // Necomprimat (conține direct text CMap)
    if (/beginbfchar|beginbfrange/.test(objContent)) {
      maps.set(objNum, parseToUnicodeCMap(objContent));
      continue;
    }

    const streamPos = raw.indexOf('\nstream', objMatch.index);
    if (streamPos === -1 || (objEnd !== -1 && streamPos > objEnd)) continue;

    let dataStart = streamPos + 7;
    if (raw[dataStart] === '\r') dataStart++;
    if (raw[dataStart] !== '\n') continue;
    dataStart++;

    const esPos = raw.indexOf('endstream', dataStart);
    if (esPos === -1) continue;
    if (!/\/FlateDecode\b|\/Fl\b/.test(objContent)) continue;

    const lenMatch = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(objContent);
    let streamEnd = esPos;
    if (lenMatch) {
      const length = parseInt(lenMatch[1], 10);
      if (length > 10 && dataStart + length <= raw.length) {
        streamEnd = dataStart + length;
      }
    }

    try {
      const dec = bytesToStr(pako.inflate(strToBytes(raw.slice(dataStart, streamEnd))));
      if (/beginbfchar|beginbfrange/.test(dec)) {
        maps.set(objNum, parseToUnicodeCMap(dec));
      }
    } catch {
      // stream corupt — ignorăm
    }
  }

  return maps;
}

// ─── Construire hărți font-name → GlyphMap ───────────────────────────────────

function buildFontGlyphMaps(
  objMap: Map<number, string>,
  toUniObjs: Map<number, GlyphMap>
): Map<string, GlyphMap> {
  const fontMaps = new Map<string, GlyphMap>();

  // Metoda 1: /Name /fontname în obiectul font (deprecated dar comun)
  for (const content of objMap.values()) {
    if (!/\/Type\s*\/Font\b/.test(content)) continue;
    const toUniMatch = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(content);
    if (!toUniMatch) continue;
    const glyphMap = toUniObjs.get(parseInt(toUniMatch[1], 10));
    if (!glyphMap) continue;
    const nameMatch = /\/Name\s+\/(\S+)/.exec(content);
    if (nameMatch) fontMaps.set(nameMatch[1], glyphMap);
  }

  // Metoda 2: parsăm dicts /Font din Resources
  for (const content of objMap.values()) {
    const fontDictRe = /\/Font\s*<<([\s\S]{1,2000}?)>>/g;
    let fd: RegExpExecArray | null;
    while ((fd = fontDictRe.exec(content)) !== null) {
      const refRe = /\/(\S+)\s+(\d+)\s+0\s+R/g;
      let ref: RegExpExecArray | null;
      while ((ref = refRe.exec(fd[1])) !== null) {
        const fontContent = objMap.get(parseInt(ref[2], 10));
        if (!fontContent) continue;
        const toUniMatch = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(fontContent);
        if (!toUniMatch) continue;
        const gm = toUniObjs.get(parseInt(toUniMatch[1], 10));
        if (gm) fontMaps.set(ref[1], gm);
      }
    }
  }

  return fontMaps;
}

// ─── Decodare string-uri PDF ──────────────────────────────────────────────────

export function decodeHexStr(hex: string, glyphMap: GlyphMap | null): string {
  if (!hex) return '';
  // Dacă lungimea e multiplu de 4 și >= 4, probabil 2-byte CID; altfel 1-byte
  const stride = hex.length % 4 === 0 && hex.length >= 4 ? 4 : 2;
  let result = '';
  for (let i = 0; i < hex.length; i += stride) {
    const code = parseInt(hex.slice(i, i + stride), 16);
    if (glyphMap && glyphMap.size > 0) {
      result += glyphMap.get(code) ?? '';
    } else if (code >= 32 && code < 127) {
      result += String.fromCharCode(code);
    }
  }
  return result;
}

function decodeStr(raw: string, glyphMap: GlyphMap | null): string {
  // Rezolvăm escape sequences PDF
  const unescaped = raw
    .replace(/\\([0-7]{1,3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')');

  if (glyphMap && glyphMap.size > 0) {
    let result = '';
    for (let i = 0; i < unescaped.length; i++) {
      result += glyphMap.get(unescaped.charCodeAt(i)) ?? '';
    }
    return result;
  }

  return decodePdfStr(unescaped);
}

const WIN1252_MAP: Record<number, string> = {
  0x80: '€',
  0x82: '‚',
  0x83: 'ƒ',
  0x84: '„',
  0x85: '…',
  0x86: '†',
  0x87: '‡',
  0x88: 'ˆ',
  0x89: '‰',
  0x8a: 'Š',
  0x8b: '‹',
  0x8c: 'Œ',
  0x8e: 'Ž',
  0x91: '‘',
  0x92: '’',
  0x93: '“',
  0x94: '”',
  0x95: '•',
  0x96: '–',
  0x97: '—',
  0x98: '˜',
  0x99: '™',
  0x9a: 'š',
  0x9b: '›',
  0x9c: 'œ',
  0x9e: 'ž',
  0x9f: 'Ÿ',
};

export function decodePdfStr(s: string): string {
  // Detectăm UTF-16BE: >25% null bytes
  const nulls = (s.match(/\x00/g) || []).length;
  if (nulls > s.length * 0.25) {
    s = s.replace(/\x00/g, '');
  }
  s = s.replace(/[\x80-\x9F]/g, c => WIN1252_MAP[c.charCodeAt(0)] ?? '');
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

// ─── Decodare ASCII85 ────────────────────────────────────────────────────────

export function decodeAscii85(s: string): Uint8Array {
  s = s.replace(/\s/g, '');
  if (s.endsWith('~>')) s = s.slice(0, -2);

  const output: number[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === 'z') {
      output.push(0, 0, 0, 0);
      i++;
      continue;
    }
    const len = Math.min(5, s.length - i);
    const chunk = s.slice(i, i + len).padEnd(5, 'u');
    let v = 0;
    for (let j = 0; j < 5; j++) {
      v = v * 85 + (chunk.charCodeAt(j) - 33);
    }
    const outBytes = len === 5 ? 4 : len - 1;
    for (let j = 0; j < outBytes; j++) {
      output.push((v >>> (24 - j * 8)) & 0xff);
    }
    i += len;
  }
  return new Uint8Array(output);
}

// ─── Conversii bytes ↔ string ─────────────────────────────────────────────────

function strToBytes(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

function bytesToStr(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}
