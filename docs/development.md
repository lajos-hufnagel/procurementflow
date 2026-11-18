# Entwicklung und Prüfungen

Node und npm sind über `.node-version` und `package.json` festgelegt. Die Lockdateien gehören zum Repository. Eine globale CAP-Installation ist nicht erforderlich.

## Installation

```sh
npm ci
npm ci --prefix erp
npm ci --prefix deployment/approuter
npx playwright install chromium
```

Unter Linux installiert `npx playwright install --with-deps chromium` auch die benötigten Systembibliotheken. SAPUI5 wird im Browser von `ui5.sap.com` geladen; die UI-Prüfungen benötigen eine Internetverbindung.

## Gemeinsamer Check

```sh
npm run check
```

| Schritt | Was geprüft wird |
|---|---|
| `typecheck` | Anwendung, ERP-Dienst, Oberflächen und TypeScript-Tests |
| `test` | Fachregeln, Berechtigungen, API, Entwürfe, Konflikte, Persistenz, Besuchertrennung und ERP-Verhalten |
| `build` | Kompilierte CAP-/ERP-Dienste, beide UI5-Bundles, AppRouter und HDI-Artefakte |
| `smoke:build` | Gebaute Dienste über HTTP, Freigabe und Wiederholung nach verlorener ERP-Antwort |
| `test:ui` | Cockpit und Fiori, DE/EN, Suche, Rollen, Entwürfe, mobile Ansichten und öffentliche Demo-Szenarien |

Tests verwenden eigene Datenbanken oder Besuchersitzungen. Playwright läuft mit einem Worker und ohne automatische Wiederholung. `gen/`, `test-results/`, `playwright-report/` und `.local/` bleiben außerhalb Git.

Die Browserregression [draft-history.spec.ts](../test/e2e/draft-history.spec.ts) hält eine echte Verlaufsabfrage bis nach der Draft-Aktivierung zurück. Sie prüft damit den früheren 404-Fehler gezielt, einschließlich Wiederöffnen und Fallwechsel.

## BTP-Paket

```sh
npm run build:mta
```

Der Build installiert die festgelegten Abhängigkeiten neu und erstellt `mta_archives/procurementflow.mtar`. Die anschließende Paketprüfung kontrolliert Laufzeitdateien, Lockdateien, Authentifizierungskonfiguration und ausgeschlossene lokale Daten. Daher den MTA-Build erst nach einem laufenden Testprozess starten.

## Container

Voraussetzung ist eine laufende Docker-Engine mit Compose:

```sh
npm run container:check
```

Dieser Check baut zwei Images, verwendet einen eigenen Compose-Projektnamen und eigene Volumes und prüft Freigabe, ERP-Ausfall, Antwortverlust sowie Datenerhalt nach Neuerstellung. Er entfernt anschließend ausschließlich seine eigenen Testressourcen.

Für einen dauerhaften lokalen Start:

```sh
npm run container:up
npm run container:down
```

## Performance und Cloud-Abnahme

```sh
npm run perf -- --cases 20000 --samples 200 --label measurement
```

Die Messung nutzt einen eigenen SQLite-Datenbestand und erzeugt einen Bericht unter `.local/performance/`. Sie ist keine HANA-Lastmessung. Sie wird außerhalb der regulären CI ausgeführt.

Die öffentlichen Browserabläufe können nach einem eigenen Deployment gegen dessen URL laufen:

```sh
PUBLIC_DEMO_TEST_URL="https://YOUR-APPROUTER-HOST" npx playwright test test/e2e/public-demo.spec.ts test/e2e/erp-scenario.spec.ts test/e2e/draft-history.spec.ts --grep 'public|Public|ERP scenario'
```

Dabei entstehen echte Testbesuchersitzungen und ERP-Testbestellungen. Browseraufzeichnungen können Sitzungscookies enthalten und bleiben lokal.

## GitHub Actions

[ci.yml](../.github/workflows/ci.yml) führt die Prüfungen, den MTA-Build und anschließend den isolierten Containercheck aus. Ein zusätzlicher Job prüft die Git-Historie auf mögliche Zugangsdaten. Die Actions sind auf konkrete Commits festgelegt; der Scanner wird anhand einer festen Prüfsumme verifiziert.

Der Workflow benötigt keine SAP-Zugangsdaten und verändert keine Cloud-Umgebung. Er wird erst nach Veröffentlichung auf GitHub tatsächlich ausgeführt. Versionsquellen: [Checkout](https://github.com/actions/checkout/releases/tag/v7.0.1), [Setup Node](https://github.com/actions/setup-node/releases/tag/v7.1.0), [Gitleaks](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1).
