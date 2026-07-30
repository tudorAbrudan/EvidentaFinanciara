"""Anonimizează extrasele BT pentru fixtures: nume persoane, ID-uri client,
IBAN-uri, REF-uri, RRN-uri, carduri. Sumele, datele și structura rămân identice."""

import json
import re
import sys

SRC_RON = "Iunie 2026.txt"
SRC_EUR = "Iunie 2027.txt"

# pool de token-uri fake pentru nume (aplicate per-token ca să reziste la word-wrap);
# fiecare token original primește un fake DISTINCT — direcția P2P se decide după
# numele titularului, deci coliziunile ar strica semantica fixture-ului
FAKE_TOKENS = [
    "POPESCU", "MIRCEA", "COSTIN", "IONEL", "FLORIN", "BARBU", "DANA",
    "CRISTINA", "GEORGE", "ELENA", "RADU", "SIMONA", "VLAD", "IRINA",
    "STANCU", "DORIN", "LAURA", "PETRE", "OANA", "CALIN", "BIANCA",
    "TIBERIU", "CARMEN", "OVIDIU", "RALUCA", "SERGIU", "MONICA", "DRAGOS",
    "ALINA", "CIPRIAN", "RAMONA", "BOGDAN", "LOREDANA", "NELU", "VIORICA",
    "SANDU", "CORINA", "TITUS", "ROXANA", "FANEL",
]

# BIC-uri bancare (CECEROBU, RNCBROBUXXX etc.) — nu sunt nume de persoane
BIC_RE = re.compile(r"^[A-Z]{4}RO[A-Z0-9]{2}([A-Z0-9]{3})?$")

STATIC_RULES: list[tuple[str, str]] = [
    ("ARMONIMED ACTIV", "CABINET EXEMPLU"),
    ("SEPTIMIU ALBINI", "EXEMPLULUI VERDE"),
    ("SEPTIMIU", "EXEMPLULUI"),
    ("ALBINI", "VERDE"),
    ("0A94705", "0A11111"),
    ("A94705", "A11111"),
    ("Revolut**2626*", "Revolut**1234*"),
    ("040115984", "000000000"),
    ("100119950", "900000001"),
    ("89000950864", "80000000001"),
    ("DE92760700120750007700", "DE00760700120000000001"),
    ("K1267589425", "K1200000001"),
]


def collect_name_tokens(joined: str) -> list[str]:
    """Nume de persoane din contexte P2P/transfer + titularul din header."""
    tokens: set[str] = set()
    name_re = r"([A-ZĂÂÎȘȚ][A-ZĂÂÎȘȚ-]+(?:\s+[A-ZĂÂÎȘȚ][A-ZĂÂÎȘȚ-]+){0,3})"
    patterns = [
        rf"Transfer din card \d+ {name_re} catre",
        rf"catre {name_re}\s+reprezentand",
        rf";\s*{name_re};",
        rf"Cont debitat: \S+;{name_re}",
    ]
    for pat in patterns:
        for m in re.finditer(pat, joined):
            for tok in re.split(r"[\s-]+", m.group(1)):
                if len(tok) >= 3 and tok.isupper() and not re.search(r"\d", tok) and not BIC_RE.match(tok):
                    tokens.add(tok)
    # titularul apare și în header, înainte de "Client:"
    m = re.search(rf"{name_re}\s*\nClient:", joined)
    if m:
        for tok in re.split(r"[\s-]+", m.group(1)):
            if len(tok) >= 3:
                tokens.add(tok)
    # excludem cuvinte generice care pot nimeri în capturi
    return sorted(tokens - {"REF", "RON", "EUR", "POS", "TID", "RRN", "CONT", "BTPAY"})


def build_ref_map(text: str, counter: dict[str, int]) -> dict[str, str]:
    refs: dict[str, str] = {}
    for m in re.finditer(r"^REF: (\S+)", text, re.M):
        ref = m.group(1)
        if ref not in refs:
            counter["n"] += 1
            refs[ref] = f"{ref[:3]}ANON{counter['n']:09d}"[: len(ref)].ljust(len(ref), "0")
    return refs


def anonymize(path: str, name_map: dict[str, str], ref_counter: dict[str, int]) -> str:
    text = open(path).read()
    joined = re.sub(r"\s+", " ", text)

    for tok in collect_name_tokens(joined):
        if tok not in name_map:
            assert len(name_map) < len(FAKE_TOKENS), "pool de nume fake epuizat — extinde FAKE_TOKENS"
            name_map[tok] = FAKE_TOKENS[len(name_map)]

    for old, new in STATIC_RULES:
        text = text.replace(old, new)
    for old, new in sorted(name_map.items(), key=lambda kv: -len(kv[0])):
        text = re.sub(rf"\b{old}\b", new, text)

    # carduri: mapare per-unic ca să rămână distincte (semantica sender/receiver)
    cards: dict[str, str] = {}
    def card_sub(m: re.Match[str]) -> str:
        c = m.group(1)
        if c not in cards:
            cards[c] = str(1111 * (len(cards) + 1))
        return f"card {cards[c]}"
    text = re.sub(r"card (\d{4})", card_sub, text)

    text = re.sub(r"RRN:\s*\d+", "RRN:000000000000", text)

    refs = build_ref_map(text, ref_counter)
    for old, new in refs.items():
        text = text.replace(old, new)
    return text


def extract_expected(text: str) -> dict[str, object]:
    days = []
    day_re = re.compile(
        r"^(\d{2}/\d{2}/\d{4})\nRULAJ ZI\n([\d,]+\.\d{2})\n([\d,]+\.\d{2})\nSOLD FINAL ZI \n([\d,]+\.\d{2})",
        re.M,
    )
    for m in day_re.finditer(text):
        d, de, cr, sold = m.groups()
        days.append({
            "date": f"{d[6:10]}-{d[3:5]}-{d[0:2]}",
            "debit": float(de.replace(",", "")),
            "credit": float(cr.replace(",", "")),
            "sold_final": float(sold.replace(",", "")),
        })
    tot = re.search(
        r"RULAJ TOTAL CONT\n([\d,]+\.\d{2})\n([\d,]+\.\d{2})\nSOLD FINAL CONT \n([\d,]+\.\d{2})",
        text,
    )
    refs = len(re.findall(r"^REF:", text, re.M))
    return {
        "transaction_count": refs,
        "total_debit": float(tot.group(1).replace(",", "")) if tot else None,
        "total_credit": float(tot.group(2).replace(",", "")) if tot else None,
        "sold_final": float(tot.group(3).replace(",", "")) if tot else None,
        "days": days,
    }


def amounts_signature(text: str) -> list[str]:
    return sorted(re.findall(r"\b\d{1,3}(?:,\d{3})*\.\d{2}\b", text))


name_map: dict[str, str] = {}
ref_counter = {"n": 0}
out = {}
for src, dst, cur in [(SRC_RON, "bt-extras-ron-2026-06.txt", "RON"), (SRC_EUR, "bt-extras-eur-2026-06.txt", "EUR")]:
    anon = anonymize(src, name_map, ref_counter)
    assert amounts_signature(open(src).read()) == amounts_signature(anon), f"sume modificate în {src}!"
    open(dst, "w").write(anon)
    out[dst] = {"account_currency": cur, **extract_expected(anon)}
    print(f"{src} -> {dst}: {out[dst]['transaction_count']} tranzactii, "
          f"debit {out[dst]['total_debit']}, credit {out[dst]['total_credit']}, "
          f"{len(out[dst]['days'])} zile")

json.dump(out, open("expected.json", "w"), indent=2, ensure_ascii=False)
print("\nname_map:", json.dumps(name_map, ensure_ascii=False))

# verificare finală: niciun token original rămas
leftover = []
for dst in ["bt-extras-ron-2026-06.txt", "bt-extras-eur-2026-06.txt"]:
    t = open(dst).read()
    for bad in list(name_map) + ["A94705", "ARMONIMED", "2626"]:
        if re.search(rf"\b{bad}\b", t):
            leftover.append((dst, bad))
print("leftover:", leftover if leftover else "NONE")
