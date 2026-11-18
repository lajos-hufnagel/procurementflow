# ProcurementFlow

ProcurementFlow unterstützt den Einkauf bei gefährdeten Materialbedarfen. Lieferangebote werden verglichen und Beschaffungsentscheidungen nachvollziehbar freigegeben.

## Language

**KERNVADO Systems**:
Der fiktive Hersteller von Steuerungs- und Automatisierungstechnik, dessen Einkauf ProcurementFlow verwendet.
_Avoid_: ProcurementFlow als Firmenname

**Material**:
Ein eindeutig bezeichnetes Gut, das in einer bestimmten Mengeneinheit beschafft wird.
_Avoid_: Artikel und Produkt als wechselnde Bezeichnungen für dasselbe Material

**Bedarf**:
Eine benötigte Menge eines Materials an einem bestimmten Ort zu einem bestimmten Termin, gegebenenfalls zugeordnet zu einem Auftrag.
_Avoid_: Bestellung, Beschaffungsfall

**Lieferengpass**:
Die absehbare fehlende Deckung eines Bedarfs in der benötigten Menge bis zu seinem Bedarfstermin.
_Avoid_: Lieferverzug, wenn noch keine verbindliche Bestellung besteht

**Lieferangebot**:
Ein Vorschlag eines Lieferanten für Material, Menge, Nettopreis, Versandkosten und Liefertermin mit begrenzter Gültigkeit.
_Avoid_: Bestellung, verbindliche Lieferung

**Referenzangebot**:
Das bisher vorgesehene Lieferangebot, dessen Konditionen als Vergleichsgrundlage für alternative Lieferangebote dienen.
_Avoid_: Ursprungsbestellung, wenn das Angebot noch nicht bestellt wurde

**Beschaffungsfall**:
Der fachliche Vorgang, in dem ein gefährdeter Bedarf, die verfügbaren Lieferangebote und die zugehörigen Entscheidungen zusammengeführt werden.
_Avoid_: Ticket, Serviceauftrag

**Beschaffungsentscheidung**:
Die begründete Auswahl eines Lieferangebots für einen Beschaffungsfall einschließlich der zur Entscheidung gehörenden Mengen, Kosten und Termine.
_Avoid_: Bestellung, Freigabe

**Einreichung**:
Die Übergabe einer begründeten Beschaffungsentscheidung mit festgehaltenen Konditionen zur Prüfung durch einen Freigeber.
_Avoid_: Freigabe, Bestellung

**Rücknahme**:
Das Zurückziehen einer eingereichten Beschaffungsentscheidung zur erneuten Bearbeitung, solange noch keine Freigabe oder Ablehnung erfolgt ist.
_Avoid_: Bestellstornierung, Widerruf einer bereits erteilten Freigabe

**Ablehnung**:
Die begründete Zurückweisung einer eingereichten Beschaffungsentscheidung durch einen Freigeber; eine überarbeitete Entscheidung kann erneut eingereicht werden.
_Avoid_: Rücknahme, Löschung des Beschaffungsfalls

**Freigabe**:
Die dokumentierte Zustimmung zu einer bestimmten Beschaffungsentscheidung durch eine berechtigte Person. Im regulären Ablauf darf diese Person die Entscheidung nicht selbst eingereicht haben; die Demo-Selbstfreigabe ist eine ausdrücklich ausgewiesene Ausnahme.
_Avoid_: Bestellung, Übertragungserfolg

**Demo-Selbstfreigabe**:
Die Freigabe einer eigenen Einreichung durch die kombinierte Demo-Identität „Dual“ ausschließlich zur Vorführung des Ablaufs ohne Personenwechsel.
_Avoid_: unabhängige Vier-Augen-Freigabe

**Bestellung**:
Der vom bestellführenden System bestätigte Beschaffungsvorgang mit eigener Bestellnummer und festgehaltenen Konditionen.
_Avoid_: Freigabe, Warenlieferung

**Übertragungsauftrag**:
Die Aufgabe, eine bestimmte freigegebene Einreichung an das bestellführende System zu übergeben. Wiederholte Versuche gehören zum selben Auftrag und dürfen keine zusätzliche Bestellung erzeugen.
_Avoid_: erneute Freigabe, neue Bestellung bei jedem Versuch

**Übertragungsstatus**:
Der Bearbeitungsstand eines Übertragungsauftrags, vom ausstehenden Versuch bis zur bestätigten Bestellung oder zum Fehler.
_Avoid_: Freigabestatus, Lieferstatus

**Mehrkosten**:
Die Differenz zwischen den Nettogesamtkosten des gewählten Lieferangebots und denen des Referenzangebots bei gleicher Menge und Währung, jeweils einschließlich Versandkosten.
_Avoid_: Einsparung bei positiver Differenz, Ausfallkosten

**Bewertungsdatum**:
Der fachliche Kalendertag, auf den sich die Bewertung von Angebotsgültigkeit und zeitlicher Dringlichkeit bezieht.
_Avoid_: Zeitpunkt eines Historieneintrags

**Zeitkritischer Beschaffungsfall**:
Ein offener, eingereichter oder abgelehnter Beschaffungsfall, dessen Bedarf spätestens drei Kalendertage nach dem Bewertungsdatum besteht; überfällige Bedarfe sind eingeschlossen.
_Avoid_: freigegebene oder bestellte Fälle als noch offene zeitkritische Entscheidungen zählen
