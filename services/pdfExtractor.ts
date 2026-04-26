/**
 * Extragere text din PDF — parser cu pako + ToUnicode CMap.
 * Suportă: FlateDecode, text necomprimat, UTF-16BE, Windows-1252,
 *           fonturi cu encoding custom (ToUnicode CMap).
 */

import * as FileSystem from 'expo-file-system/legacy';
import { extractTextFromPdfViaOcr } from '@/services/pdfOcr';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pako = require('pako') as { inflate: (data: Uint8Array) => Uint8Array };

type GlyphMap = Map<number, string>;

export async function extractTextFromPdf(fileUri: string): Promise<string> {
  // Folosim întotdeauna OCR pe imagini — mai robust decât parserul text
  // pentru PDF-uri cu fonturi CID (Identity-H), care sunt standard în documente oficiale.
  try {
    const ocrResult = await extractTextFromPdfViaOcr(fileUri);
    if (ocrResult.length > 0) {
      console.log(`[pdfExtractor] OCR imagini: ${ocrResult.length} chars`);
      return ocrResult;
    }
  } catch (e) {
    console.log('[pdfExtractor] eroare OCR imagini:', e instanceof Error ? e.message : String(e));
  }

  // Fallback la parserul text dacă modulul nativ PdfRenderer nu e disponibil
  console.log('[pdfExtractor] fallback la parser text');
  try {
    const uri = fileUri.startsWith('file://') ? fileUri : `file://${fileUri}`;
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return parsePdf(base64);
  } catch {
    return '';
  }
}

// ─── Parser principal ─────────────────────────────────────────────────────────

function parsePdf(base64: string): string {
  const raw = atob(base64);

  // Construim harta obiectelor: număr → conținut raw (dict + stream dacă există)
  const objMap = buildObjMap(raw);

  // Construim harta ToUnicode: număr obiect → GlyphMap
  const toUniObjs = buildToUnicodeMaps(raw, objMap);

  // Construim harta font-name → GlyphMap (din Resources + obiecte Font)
  const fontGlyphMaps = buildFontGlyphMaps(raw, objMap, toUniObjs);

  // Extragem textul din stream-urile de conținut
  const parts: string[] = [];

  let pos = 0;
  while (pos < raw.length) {
    // Găsim keyword-ul "stream" — poate fi precedat de \n, \r\n sau direct de >>
    let streamPos = -1;
    let searchPos = pos;
    while (searchPos < raw.length) {
      const idx = raw.indexOf('stream', searchPos);
      if (idx === -1) break;
      // Nu trebuie să fie 'endstream'
      if (idx >= 3 && raw.slice(idx - 3, idx) === 'end') {
        searchPos = idx + 6;
        continue;
      }
      // Trebuie urmat de \r\n sau \n
      const c = raw[idx + 6];
      if (c === '\r' || c === '\n') {
        streamPos = idx;
        break;
      }
      searchPos = idx + 1;
    }
    if (streamPos === -1) break;

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

    // Ignorăm stream-uri non-text
    if (/\/Type\s*\/XRef/.test(dict)) {
      pos = streamPos + 1;
      continue;
    }
    if (/\/Subtype\s*\/Image/.test(dict)) {
      pos = streamPos + 1;
      continue;
    }
    if (/\/Type\s*\/Metadata/.test(dict)) {
      pos = streamPos + 1;
      continue;
    }
    if (/\/Length1\b/.test(dict)) {
      pos = streamPos + 1;
      continue;
    } // font programs

    // Determinăm capătul stream-ului
    const lenMatch = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    const esPos = raw.indexOf('endstream', dataStart);
    if (esPos === -1) {
      pos = streamPos + 1;
      continue;
    }

    let streamEnd = esPos;
    if (lenMatch) {
      const length = parseInt(lenMatch[1], 10);
      if (length > 10 && dataStart + length <= raw.length) {
        streamEnd = dataStart + length;
      }
    }

    const hasFlateDecode = /\/FlateDecode\b|\/Fl\b/.test(dict);
    const hasAscii85 = /\/ASCII85Decode\b|\/A85\b/.test(dict);
    const hasFilter = /\/Filter\b/.test(dict);
    const streamStr = raw.slice(dataStart, streamEnd);
    let streamBytes = strToBytes(streamStr);

    let content: string;
    if (hasAscii85) {
      // Decodăm ASCII85, apoi inflăm dacă mai e FlateDecode
      try {
        streamBytes = decodeAscii85(streamStr);
        if (hasFlateDecode) {
          const decompressed = pako.inflate(streamBytes);
          content = bytesToStr(decompressed);
        } else {
          content = bytesToStr(streamBytes);
        }
      } catch {
        pos = streamEnd + 1;
        continue;
      }
    } else if (hasFlateDecode) {
      try {
        const decompressed = pako.inflate(streamBytes);
        content = bytesToStr(decompressed);
      } catch {
        pos = streamEnd + 1;
        continue;
      }
    } else if (!hasFilter) {
      content = streamStr;
    } else {
      pos = streamEnd + 1;
      continue;
    }

    const text = extractTextOps(content, fontGlyphMaps);
    if (text.trim()) parts.push(text);

    pos = streamEnd + 1;
  }

  return parts
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
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
  const map = new Map<number, string>();

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
  // Secvență UTF-16BE
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
    // Din obiecte /Font
    const tuMatch = /\/ToUnicode\s+(\d+)\s+0\s+R/g;
    let m: RegExpExecArray | null;
    while ((m = tuMatch.exec(content)) !== null) {
      toUniNums.add(parseInt(m[1], 10));
    }
    // Din dicts /Font din Resources
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
    // Căutăm obiectul în raw
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

    // Comprimat: găsim stream-ul
    const streamPos = raw.indexOf('\nstream', objMatch.index);
    if (streamPos === -1 || (objEnd !== -1 && streamPos > objEnd)) continue;

    let dataStart = streamPos + 7;
    if (raw[dataStart] === '\r') dataStart++;
    if (raw[dataStart] !== '\n') continue;
    dataStart++;

    const esPos = raw.indexOf('endstream', dataStart);
    if (esPos === -1) continue;

    const hasFlateDecode = /\/FlateDecode\b|\/Fl\b/.test(objContent);
    if (!hasFlateDecode) continue;

    const lenMatch = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(objContent);
    let streamEnd = esPos;
    if (lenMatch) {
      const length = parseInt(lenMatch[1], 10);
      if (length > 10 && dataStart + length <= raw.length) {
        streamEnd = dataStart + length;
      }
    }

    const bytes = strToBytes(raw.slice(dataStart, streamEnd));
    try {
      const dec = bytesToStr(pako.inflate(bytes));
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
  _raw: string,
  objMap: Map<number, string>,
  toUniObjs: Map<number, GlyphMap>
): Map<string, GlyphMap> {
  const fontMaps = new Map<string, GlyphMap>();

  for (const content of objMap.values()) {
    // Obiecte Font cu /ToUnicode
    if (!/\/Type\s*\/Font\b/.test(content)) continue;

    const toUniMatch = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(content);
    if (!toUniMatch) continue;
    const toUniObjNum = parseInt(toUniMatch[1], 10);
    const glyphMap = toUniObjs.get(toUniObjNum);
    if (!glyphMap) continue;

    // Metoda 1: /Name /fontname în obiectul font (deprecated dar comun)
    const nameMatch = /\/Name\s+\/(\S+)/.exec(content);
    if (nameMatch) {
      fontMaps.set(nameMatch[1], glyphMap);
    }
  }

  // Metoda 2: parsăm dicts /Font din Resources
  for (const content of objMap.values()) {
    const fontDictRe = /\/Font\s*<<([\s\S]{1,2000}?)>>/g;
    let fd: RegExpExecArray | null;
    while ((fd = fontDictRe.exec(content)) !== null) {
      const refRe = /\/(\S+)\s+(\d+)\s+0\s+R/g;
      let ref: RegExpExecArray | null;
      while ((ref = refRe.exec(fd[1])) !== null) {
        const resName = ref[1];
        const fontObjNum = parseInt(ref[2], 10);
        const fontContent = objMap.get(fontObjNum);
        if (!fontContent) continue;
        const toUniMatch2 = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(fontContent);
        if (!toUniMatch2) continue;
        const gm = toUniObjs.get(parseInt(toUniMatch2[1], 10));
        if (gm) fontMaps.set(resName, gm);
      }
    }
  }

  return fontMaps;
}

// ─── Extragere operatori text cu context font ─────────────────────────────────

function extractTextOps(content: string, fontMaps: Map<string, GlyphMap>): string {
  const texts: string[] = [];
  let lastWasSpace = false;

  const btEt = /BT[\s\S]{1,50000}?ET/g;
  let block: RegExpExecArray | null;

  while ((block = btEt.exec(content)) !== null) {
    const b = block[0];
    let currentGlyphMap: GlyphMap | null = null;

    // Parsăm operatorii în ordine:
    // - /FontName size Tf  → schimbare font
    // - (text)Tj sau (text)'  → string literal
    // - <hex>Tj sau <hex>'  → string hex
    // - [...] TJ  → array text (poate conține (text) sau <hex> și numere)
    const opRe =
      /\/(\S+)\s+[\d.]+\s+Tf|\(((?:[^()\\]|\\.)*)\)\s*(?:Tj|')|<([0-9a-fA-F]*)>\s*(?:Tj|')|\[([\s\S]{0,5000}?)\]\s*TJ/g;
    let op: RegExpExecArray | null;

    while ((op = opRe.exec(b)) !== null) {
      if (op[1] !== undefined) {
        // Tf: schimbare font
        currentGlyphMap = fontMaps.get(op[1]) ?? null;
      } else if (op[2] !== undefined) {
        // (text)Tj
        const t = decodeStr(op[2], currentGlyphMap);
        if (t.trim()) {
          texts.push(t);
          lastWasSpace = false;
        }
      } else if (op[3] !== undefined) {
        // <hex>Tj
        const t = decodeHexStr(op[3], currentGlyphMap);
        if (t.trim()) {
          texts.push(t);
          lastWasSpace = false;
        }
      } else if (op[4] !== undefined) {
        // [...] TJ — poate conține (text) și <hex> intercalate cu numere
        const inner = op[4];
        const partRe = /\(((?:[^()\\]|\\.)*)\)|<([0-9a-fA-F]*)>|(-?\d+(?:\.\d+)?)/g;
        let part: RegExpExecArray | null;
        while ((part = partRe.exec(inner)) !== null) {
          if (part[1] !== undefined) {
            const t = decodeStr(part[1], currentGlyphMap);
            if (t.trim()) {
              texts.push(t);
              lastWasSpace = false;
            }
          } else if (part[2] !== undefined) {
            const t = decodeHexStr(part[2], currentGlyphMap);
            if (t.trim()) {
              texts.push(t);
              lastWasSpace = false;
            }
          } else if (part[3] !== undefined) {
            const numVal = parseFloat(part[3]);
            if (numVal < -100 && !lastWasSpace) {
              texts.push(' ');
              lastWasSpace = true;
            }
          }
        }
      }
    }
  }

  return texts.join('');
}

// ─── Decodare hex string PDF (<0029> etc.) ────────────────────────────────────

export function decodeHexStr(hex: string, glyphMap: Map<number, string> | null): string {
  if (!hex) return '';
  // Fiecare cod e reprezentat de 2 sau 4 hex chars
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

// ─── Decodare string PDF ──────────────────────────────────────────────────────

function decodeStr(raw: string, glyphMap: GlyphMap | null): string {
  // Rezolvăm escape sequences PDF
  const unescaped = raw
    .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')');

  // Dacă avem o hartă de glife (ToUnicode), o folosim
  if (glyphMap && glyphMap.size > 0) {
    let result = '';
    for (let i = 0; i < unescaped.length; i++) {
      const code = unescaped.charCodeAt(i);
      result += glyphMap.get(code) ?? '';
    }
    return result;
  }

  // Fallback: decodare standard (UTF-16BE, Windows-1252)
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
  0x91: '\u2018',
  0x92: '\u2019',
  0x93: '\u201C',
  0x94: '\u201D',
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
  // Eliminăm whitespace și markerul de sfârșit ~>
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
    // Numărul de bytes output = len - 1 (grupuri incomplete)
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

// ─── Utilitar ─────────────────────────────────────────────────────────────────

export function isPdfFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.pdf');
}
