# Infrastrukturvorlage

Terraform verwaltet einen eigenen Cloud-Foundry-Space, dessen Operatorrolle sowie die vorhandenen Servicepläne `destination/lite` und `connectivity/lite`. MTA verwaltet Apps, HDI, XSUAA, Bindungen und den Destination-Inhalt. Dieselbe Ressource darf nicht gleichzeitig von beiden Werkzeugen verwaltet werden.

Konto, Organisation, HANA-Instanz und verfügbare Servicepläne müssen vor einem Deployment geklärt sein. Diese Vorlage legt keine HANA-Instanz an. Die Tool- und Provider-Versionen stehen in [versions.tf](versions.tf), die Provider-Prüfsummen in `.terraform.lock.hcl`.

```sh
terraform -chdir=infra init -backend=false -input=false
terraform -chdir=infra fmt -check
terraform -chdir=infra validate
cp infra/terraform.tfvars.example infra/terraform.tfvars
```

In `terraform.tfvars` die Platzhalter durch die eigene Org- und Benutzer-GUID ersetzen. Diese Datei sowie State und Pläne sind von Git ausgeschlossen. Der Provider nutzt die vorhandene CF-CLI-Anmeldung. Plan und Zielumgebung vor jedem Apply prüfen; vorhandene Ressourcen zuerst korrekt in den State übernehmen.

```sh
terraform -chdir=infra plan -out=deployment.tfplan
terraform -chdir=infra apply deployment.tfplan
terraform -chdir=infra plan -detailed-exitcode
```

Diese Befehle sind Betreiberaktionen. CI führt weder Apply noch Destroy aus. Weitere Schritte: [BTP-Deployment](../docs/deployment.md).
