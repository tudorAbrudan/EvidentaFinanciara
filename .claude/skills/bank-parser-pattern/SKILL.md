---
name: bank-parser-pattern
description: Use when editing or adding parsers in services/bankStatement*.ts — enforces fixture-based testing, regex robustness, deduplication, and edge cases for RO bank statements (BT, ING, Revolut, OTP).
---

# Bank parser pattern — Finanțe Personale

Reguli pentru parser-uri de extrase bancare RO.

## Fixture obligatorie

Pentru fiecare bancă/format suportat, creează fixture în `__tests__/fixtures/<bank>/`:

- PDF/CSV scurt (5–10 tranzacții).
- **Anonimizat:** înlocuiește IBAN, sume mari, nume reale cu valori dummy. **Niciun document real al utilizatorului.**
- Numire: `<bank>-<format>-<scenariu>.{pdf,csv}` (ex. `bt-csv-multi-currency.csv`).

## Test obligatorii

Pentru fiecare parser nou/modificat:

- [ ] **Parse OK** pe fixture canonică (toate tranzacțiile parsate).
- [ ] **Deduplicate**: aceeași fixture import-ată de două ori nu produce duplicate (verificare prin hash sau combinație `account+date+amount+description`).
- [ ] **Multi-currency**: RON și EUR în același extras parsate corect (separate sau cu conversie).
- [ ] **Decimal separator**: virgulă (`1.234,56`) și punct (`1,234.56`) — formatul depinde de bancă.
- [ ] **Date format**: RO (`DD.MM.YYYY`, `DD/MM/YYYY`) și ISO (`YYYY-MM-DD`).
- [ ] **Headere/footere repetate**: extrase cu pagini multiple unde header-ul reapare → nu interpreta header ca tranzacție.
- [ ] **Tranzacție debit vs credit**: semn corect (negativ pentru cheltuieli, pozitiv pentru încasări).

## Regex robuste

- **Nu generic** care prinde header și footer. Folosește anchor specific (data la început, sumă la sfârșit).
- **Suportă variații**: spațiu sau tab între câmpuri, ghilimele opționale în CSV, `\r\n` și `\n`.
- **Numere mari**: `1.234.567,89` (RO) — separator mii este `.` sau spațiu, decimal e `,`.

## Edge cases

- **Storno / refund**: tranzacție care anulează una anterioară. Păstrează ambele cu legătură (sau marchează ca anulate).
- **Comision separat**: unele bănci listează comisionul ca tranzacție separată — păstrează.
- **Tranzacție cu mai multe rânduri descrierea**: concatenează toate rândurile aceleași tranzacții.
- **Conversie valutară**: cumpărătură EUR debit din cont RON → arată sumă originală + sumă efectivă.

## Texte de eroare

În română, prietenos:

- ❌ `"Failed to parse line"`
- ✅ `"Nu am putut citi linia <N>: format necunoscut"`

## Anti-patterns

- ❌ Regex care match-uiește orice rând cu cifre (prinde și sume agregate din footer).
- ❌ Test fără fixture commitată — test fragil, ne-reproductibil.
- ❌ Skip deduplicate — userul re-importează același extras și vede totul de două ori.
- ❌ Hardcoding ordine coloane CSV — parsează header dinamic dacă banca poate schimba ordinea.
