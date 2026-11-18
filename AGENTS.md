# ProcurementFlow – Arbeitsregeln

- Antworten und Dokumentation standardmäßig auf Deutsch; die App unterstützt Deutsch und Englisch. In deutschen Bedientexten siezen.
- Der Projektumfang ist die vorhandene CAP-/UI5-Demo mit ERP-Testdienst. Erweiterungen in [docs/roadmap.md](docs/roadmap.md) sind optional.
- Einstieg: [README.md](README.md), Fachbegriffe: [docs/domain.md](docs/domain.md), Aufbau: [docs/architecture.md](docs/architecture.md).
- Node-Version aus `.node-version` und npm-Version aus `package.json` verwenden. Lockdateien erhalten.
- Vor einer Übergabe `npm run check` ausführen; Installationsschritte stehen in [docs/development.md](docs/development.md).
- Tests verwenden eigene Datenbanken und Besuchersitzungen. Persönliche Demodaten nicht zurücksetzen.
- Regeln, Berechtigungen, Kosten und Zustandswechsel im Backend durchsetzen. Entwürfe und fachliche Einreichungen unterscheiden.
- Regulär gilt das Vier-Augen-Prinzip. Nur die simulierte Dual-Identität im öffentlichen Demo-Profil darf sich selbst freigeben.
- ERP-Wiederholungen müssen dieselbe Operation-ID behalten und dürfen keine zweite Bestellung erzeugen.
- Echte Zugangsdaten, lokale Konfigurationen, Datenbanken, Terraform-State und Testberichte bleiben außerhalb Git.
- Änderungen passend prüfen und dokumentieren. Nur tatsächlich ausgeführte Tests und Deployments als erfolgreich bezeichnen.
- Die Git-Historie beginnt mit einem zusammengeführten Demo-Stand; keine rückwirkende Entwicklungshistorie erfinden.
