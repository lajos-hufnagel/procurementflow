# BTP-Deployment

Die Anwendung kann mit HANA/HDI, AppRouter, XSUAA und einer OAuth-Destination in Cloud Foundry betrieben werden. Das Repository enthält generische Konfigurationen; persönliche Zugänge, Instanz-IDs und lokale Service-Bindings gehören nicht in Git.

## Voraussetzungen

- Eigene Cloud-Foundry-Organisation und ein dedizierter Space mit passenden Berechtigungen.
- Eine laufende HANA-Cloud-Instanz und verfügbare HDI-, XSUAA-, Destination- und Connectivity-Servicepläne.
- CF CLI mit MultiApps-Plugin sowie die Node-/npm-Versionen aus dem Projekt.
- Die vorhandenen Instanzen `pf-destination` und `pf-connectivity`. Eine passende [Terraform-Vorlage](../infra/README.md) ist enthalten.

Verfügbarkeit und Konditionen der Servicepläne im eigenen Konto vor der Anlage prüfen. Die öffentliche Demo und ihre Trial-Verfügbarkeit sind kein zugesicherter Dauerbetrieb.

## Konfigurieren und bauen

Melden Sie sich über die CF CLI an der eigenen API an und wählen Sie Organisation und Space. Die persönliche Anmeldung und Service-Bindings bleiben lokal.

```sh
mkdir -p .local
cp deployment/btp/trial.mtaext.example .local/trial.mtaext
```

Ersetzen Sie in `.local/trial.mtaext` den Platzhalter durch die GUID Ihrer vorhandenen HANA-Instanz. Anschließend:

```sh
npm run check:btp-config -- .local/trial.mtaext
npm run build:mta
```

Die Syntaxprüfung kontrolliert den lokalen Deskriptor. Berechtigungen und tatsächliche Erreichbarkeit ergeben sich erst aus der Zielumgebung.

## Öffentliche Demo bereitstellen

```sh
cf deploy mta_archives/procurementflow.mtar -e .local/trial.mtaext,deployment/btp/public-demo.mtaext
```

Die Erweiterung aktiviert öffentliche Besuchersitzungen und setzt den erwarteten HTTPS-Origin auf die AppRouter-Route. Die technische ERP-Anbindung bleibt über XSUAA/OAuth geschützt. Für eine abweichende Route muss `PUBLIC_DEMO_ORIGIN` passend gesetzt werden.

Das Paket enthält die drei Laufzeitanwendungen `pf-srv`, `pf-erp` und `pf-router` sowie zwei HDI-Deployer. Unveränderliche Statuslisten werden über HDI importiert. Geschäftsdaten werden ausdrücklich und ausschließlich in einen leeren Anfangsbestand eingefügt:

```sh
cf run-task pf-srv --name demo-initialization --command 'node scripts/seed-demo.mjs'
```

Task-Status und Protokoll prüfen. Die Initialisierung ist kein Reset-Befehl und wird bei belegtem Geschäftsdatenbestand abgewiesen. Sie gehört nicht zu einem normalen erneuten Deployment.

## Geschützte Variante

Ohne `deployment/btp/public-demo.mtaext` verwendet der AppRouter die geschützte XSUAA-Konfiguration. Dann benötigen echte Benutzer die passenden Role Collections `ProcurementFlow_Buyer`, `ProcurementFlow_Approver` oder `ProcurementFlow_Reader`. Das reguläre Vier-Augen-Prinzip gilt auch bei kombinierten Rollen.

## Prüfen und wieder starten

Nach dem Deployment Fälle laden, einen vollständigen Bestellablauf ausführen und die [öffentlichen Browserprüfungen](development.md#performance-und-cloud-abnahme) gegen die eigene URL laufen lassen. Ein HTTP-200 auf `/health` allein beweist keine funktionierende Datenbank oder Bestellung.

Bei einer gestoppten Trial-Umgebung zuerst den HANA-Zustand prüfen und die Datenbank gegebenenfalls im Cockpit starten. Danach:

```sh
cf start pf-erp
cf start pf-srv
cf start pf-router
cf apps
```

Die beiden DB-Deployer bleiben gestoppt. Ein normaler Wiederanlauf braucht weder ein neues Deployment noch eine erneute Dateninitialisierung.

Für spätere Versionen müssen Datenbankänderungen und die Kompatibilität zu laufenden Anwendungen separat beurteilt werden. Ein automatisches Deployment und ein praktisch verifizierter Release-Rollback sind [optionale Erweiterungen](roadmap.md).
