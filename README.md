# PokeTracker

Tägliche Preisanalyse für Pokémon-Displays und -Booster mit Telegram-Morgenbericht und Dashboard.
Quellen (geplant): Cardmarket, deutsche TCG-Shops, eBay, CardTrader.

**Status:** Phase 1 – Datenbasis (Cardmarket) ✅ · Phase 2 – Deutsche Shops ✅

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

## Deutsche Shops (Phase 2)

`src/update-shops.mjs` fragt täglich die Display-Kategorien von sieben Shops ab, einmal pro Tag und mit Pausen zwischen den Abrufen:

| Shop | System | Quelle |
|---|---|---|
| Card-Corner | JTL | Kategorieseite (schema.org-Microdata) |
| Gate to the Games | JTL | Kategorieseiten Displays + japanische Displays |
| Trader-Online | OXID | Kategorieseite Booster-Displays |
| Cardcosmos | Shopify | Kollektion `pokemon-booster-displays` (JSON) |
| Balucards | Shopify | Kollektionen `booster-displays`, `japanische-produkte` (JSON) |
| TCG-24 | WooCommerce | Store-API-Suche (JSON) |
| Loco TCG | WooCommerce | Store-API-Suche (JSON) |

Jedes Angebot wird einem Cardmarket-Display zugeordnet (`src/shops/match.mjs`):

- **Sprache:** aus dem Titel („deutsch“, „JPN“, „(CN)“ …), sonst aus japanischen Set-Codes wie „(sv11B)“, sonst aus dem Setnamen („Obsidianflammen“ → de, „Obsidian Flames“ → en).
- **Format:** 36er → `booster-box`, 18er → `half-box`, Jumbo → `jumbo-box`.
- **Set:** über englische und deutsche Setnamen, Shop-Schreibweisen (`data/shop-aliases.json`) und chinesische Set-Codes („CBB5C“).
- **Aussortiert:** Mini-Tins, Sleeved-Displays, Zubehör und koreanische Ware (dafür gibt es kein Cardmarket-Gegenstück).
- **Gesamtpreis:** Preis plus Versand nach Deutschland gemäß `src/shops/config.mjs`.

| Datei | Inhalt |
|---|---|
| `data/shops/latest.json` | alle Display-Angebote von heute, auch nicht zugeordnete mit Grund |
| `data/shop-history/YYYY-MM.csv` | `date,shop,cmId,lang,price,total,stock,damaged,key` |

## Cardmarket als Kaufquelle

Neben den Shops gilt das günstigste Cardmarket-Angebot („ab“) plus **geschätzt 8 € Versand** (`CM_SHIPPING_EST` in `src/lib/analysis.mjs`) als Kaufmöglichkeit.

- **Sprache:** Bei internationalen Displays ist sie unbekannt („Sprache gemischt“).
- **Unplausible Preise:** „ab“-Preise unter 70 % oder über 150 % des Trends zählen nicht als Bestpreis, sondern nur als Hinweis.
- **Wann es eine Kaufchance ist:** Ein Cardmarket-Angebot ist eine Kaufchance, wenn es deutlich unter dem üblichen „ab“-Preis der letzten 14 Tage liegt.

## eBay (optional)

Die Anbindung über die offizielle eBay Browse API ist eingebaut und läuft, sobald Schlüssel vorhanden sind. Sie sucht täglich die 12 neuesten internationalen Sets (Suche auf DE und EN) und die 10 neuesten japanischen Sets. Es zählen nur Angebote, die neu sind, einen Festpreis haben, nach Deutschland liefern und von Verkäufern mit mindestens 98 % positiven Bewertungen und mindestens 50 Bewertungen stammen. Pro Display und Sprache werden die 3 günstigsten Angebote übernommen.

Einrichtung:

1. Auf https://developer.ebay.com ein kostenloses Entwicklerkonto anlegen.
2. Unter „Application Keys“ ein **Production**-Keyset erzeugen.
3. `EBAY_CLIENT_ID` (App ID) und `EBAY_CLIENT_SECRET` (Cert ID) in `.env` eintragen.
4. Dieselben Werte als GitHub-Secrets hinterlegen.

## Lokal ausführen

Benötigt Node.js ≥ 22, keine weiteren Abhängigkeiten.

```
node src/update.mjs          # Cardmarket
node src/update-shops.mjs    # Shops (optional: nur einzelne, z.B. "node src/update-shops.mjs cardcosmos")
```

Die Historie ab dem 22.10.2026 wurde einmalig aus der Git-Historie von binder-tcg-data nachgeladen (`src/backfill.mjs`).
