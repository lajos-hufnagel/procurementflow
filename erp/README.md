# Eigenständiger ERP-Testdienst

Dieser CAP-Dienst simuliert die Annahme einer Bestellung. Er verwendet einen eigenen Prozess, eine eigene SQLite-Datei und eigene Abhängigkeiten. Er ist kein S/4HANA-System. Das Hauptprojekt greift ausschließlich über HTTP auf ihn zu.

Im Repository-Wurzelverzeichnis:

```sh
npm ci
npm ci --prefix erp
npm run demo
```

Der gemeinsame Starter initialisiert fehlende Datenbanken und startet ProcurementFlow auf Port 4004 sowie den ERP-Testdienst auf Port 4005. Strg+C beendet beide. Vorhandene Daten bleiben erhalten. Ein einzelner ERP-Start ist mit `npm run erp:db:init` und `npm start --prefix erp -- --port 4005` möglich.

`POST /erp/Orders` nimmt die freigegebenen Konditionen an. `GET /erp/Orders` zeigt die dauerhaft gespeicherten Testbestellungen. Die lokale technische Identität `integration` mit Passwort `demo-integration` hat die Rolle `Integration`; `erp-admin` / `demo-erp-admin` hat zusätzlich `ErpAdmin`. Änderungen und Löschungen bestehender Bestellungen sind über die API gesperrt. Auf BTP verwendet der Testdienst XSUAA; der Hauptdienst greift über eine OAuth-Destination zu.

Die Aufruf-ID `operationID` wird vom Absender vergeben. Gleiche ID und gleiche normalisierte Konditionen liefern dieselbe Bestellnummer. Andere Konditionen unter derselben ID werden mit HTTP 409 abgewiesen. Die ID und Bestellung bleiben nach Neustart erhalten. [Architektur und Übertragungsablauf](../docs/architecture.md#erp-übertragung) beschreiben Felder, Fehler und Grenzen.

Für die lokale Vorführung in einem zweiten Terminal:

```sh
npm run erp:mode -- unavailable
npm run erp:mode -- available
npm run erp:mode -- drop-after-commit-once
```

`unavailable` beantwortet Bestellversuche mit HTTP 503. `drop-after-commit-once` speichert die nächste Bestellung zuerst verbindlich und bricht danach die Antwort ab. Der folgende Versuch liefert die vorhandene Bestellung. Der Modus gilt nur für den aktuellen Prozess; ein Neustart beginnt mit `available`, sofern `ERP_DEMO_MODE` nicht anders gesetzt ist. Die Steuerung benötigt `ErpAdmin` und ist im Produktionsprofil gesperrt.

`npm run erp:db:reset` setzt ausschließlich die lokale ERP-Datenbank zurück. Für einen vollständig frischen Vorführlauf zuerst beide Dienste stoppen, dann im Wurzelverzeichnis `npm run db:reset` und `npm run erp:db:reset` ausführen. Nur eine der beiden Datenbanken zurückzusetzen ist kein fachlicher Wiederherstellungsablauf.

Tests werden vom Hauptprojekt über `npm test` ausgeführt. Sie starten eigene ERP-Prozesse und Datenbanken. `npm run build` erzeugt beide kompilierten Dienste und getrennte HANA-/HDI-Artefakte; erzeugte Dateien sind kein HANA-Deploymentnachweis.
