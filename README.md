# PokeTracker

Tägliche Preisanalyse für Pokémon-Displays und -Booster mit Telegram-Morgenbericht und Dashboard.
Quellen (geplant): Cardmarket, deutsche TCG-Shops, eBay, CardTrader.

**Status:** Phase 1 – Datenbasis (Cardmarket) ✅

## Wie es funktioniert

Eine GitHub Action (`.github/workflows/daily.yml`) läuft jeden Morgen um 04:30 UTC:

1. lädt den Produktkatalog und die Preisübersicht von Cardmarket
   ([öffentliche Downloads](https://www.cardmarket.com/Data/Download), Spiel-ID 6 = Pokémon),
2. behält nur **Displays** (Kategorie 53) und **Booster** (Kategorie 52),
3. bestimmt Produkttyp, Set und Region (international / japanisch / chinesisch),
4. schreibt die Preise des Tages in die Historie und committet die Daten.

## Daten

| Datei | Inhalt |
|---|---|
| `data/products.json` | alle Displays und Booster mit Typ, Set, deutschem Setnamen, Region und aktuellem Preis |
| `data/history/YYYY-MM.csv` | tägliche Preise: `date,id,trend,avg,low` (Cardmarket-Produkt-ID) |
| `data/set-names.json` | Setnamen Englisch → Deutsch (von Hand gepflegt) |
| `data/region-overrides.json` | manuelle Korrekturen der Region (von Hand gepflegt) |
| `data/cache/intl-sets.json` | Liste internationaler Sets (pokemontcg.io), Fallback wenn die API ausfällt |

**Preisfelder (Cardmarket):**

- `trend`: Cardmarkets Trendpreis, der verlässlichste Wert.
- `avg`: Durchschnitt der jüngsten Verkäufe.
- `low`: günstigstes Angebot, ohne Versand und über alle Sprachen und Länder hinweg.

Für versiegelte Produkte liefert Cardmarket keine 1-, 7- oder 30-Tage-Durchschnitte. Deshalb führen wir eine eigene Historie.

**Produkttypen:**

- Displays: `booster-box` (36er), `half-box` (18er), `jumbo-box`, `bundle`, `case`, `sleeved-case`
- Booster: `booster`, `sleeved-booster`, `jumbo-booster`, `promo-pack`

**Grenzen:**

- **Sprache:** Cardmarket unterscheidet bei internationalen Produkten nicht zwischen Englisch und Deutsch. Die Preise sind ein Mischpreis über alle Sprachen.
- **Region:** Sie wird heuristisch bestimmt und stimmt zu etwa 97 % mit [binder-tcg-data](https://github.com/Donnygr-code/binder-tcg-data) überein. Fehler korrigiert man über `data/region-overrides.json`.

## Lokal ausführen

Benötigt Node.js ≥ 22, keine weiteren Abhängigkeiten.

```
node src/update.mjs
```

Die Historie ab dem 22.10.2026 wurde einmalig aus der Git-Historie von binder-tcg-data nachgeladen (`src/backfill.mjs`).
