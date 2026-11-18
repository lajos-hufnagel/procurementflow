# Demo bedienen

Das Cockpit priorisiert Bedarfe und vergleicht Lieferangebote. **Entscheidungen** öffnet die Fiori-Elements-App für Entwurf, Einreichung und Freigabe. Beide Oberflächen verwenden dieselben Geschäftsdaten und bieten Deutsch und Englisch.

## Beispiel

Das Bewertungsdatum ist **19.11.2026**. In **PF-2026-001** werden 20 Steuerungsmodule am **23.11.2026** benötigt:

| Angebot | Liefertermin | Nettogesamtkosten | Mehrkosten |
|---|---|---:|---:|
| Rhelvanto Elektronik · Referenz | 30.11.2026 | 2.000 EUR | 0 EUR |
| Tavrendo Controls | 22.11.2026 | 2.600 EUR | 600 EUR |
| Norveltrik Komponenten | 27.11.2026 | 2.250 EUR | 250 EUR |

Tavrendo deckt den Bedarfstermin. Wählen Sie dieses Angebot, begründen Sie die Entscheidung und die Mehrkosten und öffnen Sie die gespeicherte Entscheidung. Reichen Sie diese ein und wechseln Sie zur Freigabe. Nach erfolgreicher Freigabe bestätigt der ERP-Testdienst eine Bestellung.

Der Status **Freigegeben** bezeichnet die fachliche Zustimmung. Erst **Bestellt** bedeutet, dass eine passende ERP-Bestätigung vorliegt. Die App behauptet keine Warenlieferung.

## Öffentliche Demo

Jeder Besucher erhält zwölf eigene Fälle. Die Rolle wird oben gewählt:

| Rolle | Möglichkeiten |
|---|---|
| Einkauf | Entscheidung vorbereiten, einreichen, zurücknehmen und Übertragung wiederholen |
| Freigabe | Eingereichte Entscheidungen freigeben oder begründet ablehnen; Übertragung wiederholen |
| Lesen | Fälle und Fortschritt ansehen |
| Dual | Einkauf und Freigabe; ausschließlich in der öffentlichen Demo auch die eigene Einreichung freigeben |

**Demo neu starten** ersetzt nur die eigene Sitzung. Die Sitzung gilt 24 Stunden; abgelaufene Daten werden später automatisch bereinigt. Ein privates Browserfenster kann einen weiteren unabhängigen Besucher demonstrieren.

**Demo-Szenario → ERP-Ausfall simulieren** lässt die eigene Übertragung fehlschlagen. Die Freigabe bleibt erhalten. Wählen Sie **Simulation beenden**, anschließend **Übertragung wiederholen** und **Status aktualisieren**. Andere Besucher sind vom simulierten Ausfall nicht betroffen. Bereits abgeschickte Anfragen und bestätigte Bestellungen werden dadurch nicht rückgängig gemacht.

## Lokale Demo-Identitäten

Die folgenden Zugangsdaten sind absichtliche Testwerte im Entwicklungsprofil:

| Benutzer | Passwort | Rollen |
|---|---|---|
| `buyer` | `demo-buyer` | Einkauf |
| `approver` | `demo-approver` | Freigabe |
| `reader` | `demo-reader` | Lesen |
| `dual` | `demo-dual` | Einkauf und Freigabe |

Die lokale Standardvariante sperrt eigene Freigaben auch bei Dual. Das öffentliche Profil lässt sich alternativ mit `CDS_ENV=public-demo npm run demo` starten; dort gelten die oben beschriebenen Besuchersitzungen und die Dual-Ausnahme.

Der ERP-Testdienst verwendet lokal `integration` / `demo-integration` für den technischen Zugriff und `erp-admin` / `demo-erp-admin` für die lokale Ausfallsteuerung. Diese Identitäten gelten nicht als BTP-Zugangsdaten.

## Lokale Fehlerfälle und Neustart

In einem zweiten Terminal:

```sh
npm run erp:mode -- unavailable
npm run erp:mode -- available
npm run erp:mode -- drop-after-commit-once
```

Der letzte Modus verliert die nächste Antwort erst nach Speicherung der Bestellung. Eine Wiederholung bestätigt dieselbe Bestellung. Die Steuerung gilt für den lokalen ERP-Prozess.

Für einen bewusst frischen lokalen Stand zuerst beide Dienste stoppen, dann beide Datenbanken zurücksetzen:

```sh
npm run db:reset
npm run erp:db:reset
npm run demo
```

Ein normaler Start erhält bestehende Daten. `PROCUREMENT_EVALUATION_DATE` kann den Bewertungszeitpunkt für eigene Szenarien ändern; historische Ereignisse behalten ihren tatsächlichen Zeitstempel.
