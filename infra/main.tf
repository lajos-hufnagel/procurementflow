resource "cloudfoundry_space" "demo" {
  name = var.space_name
  org  = var.cf_org_id
}

resource "cloudfoundry_space_role" "operator" {
  space = cloudfoundry_space.demo.id
  user  = var.cf_operator_id
  type  = "space_developer"
}

# MTA owns apps, XSUAA, HDI, bindings and destination CONTENT, never these instances.
resource "cloudfoundry_service_instance" "network" {
  for_each              = toset(["destination", "connectivity"])
  name                  = "pf-${each.key}"
  type                  = "managed"
  space                 = cloudfoundry_space.demo.id
  service_offering_name = each.key
  service_plan_name     = "lite"
  depends_on            = [cloudfoundry_space_role.operator]
}
