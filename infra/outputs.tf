output "cf_space_id" {
  description = "Created demo space GUID."
  value       = cloudfoundry_space.demo.id
}
output "cf_space_name" {
  description = "Target this space before MTA deployment."
  value       = cloudfoundry_space.demo.name
}
output "destination_service_name" {
  value = cloudfoundry_service_instance.network["destination"].name
}
output "connectivity_service_name" {
  value = cloudfoundry_service_instance.network["connectivity"].name
}
