variable "cf_org_id" {
  description = "GUID of the existing, explicitly selected free BTP Trial CF organization."
  type        = string
  validation {
    condition     = can(regex("^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$", var.cf_org_id))
    error_message = "cf_org_id muss die GUID der zuvor geprüften Trial-Organisation sein."
  }
}

variable "cf_operator_id" {
  description = "GUID of the existing CF operator who will deploy this demo."
  type        = string
  validation {
    condition     = can(regex("^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$", var.cf_operator_id))
    error_message = "cf_operator_id muss eine vorhandene CF-Benutzer-GUID sein."
  }
}

variable "space_name" {
  description = "Dedicated demo space; do not reuse an unrelated existing space."
  type        = string
  default     = "procurementflow"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,39}$", var.space_name))
    error_message = "space_name: 3 bis 40 Kleinbuchstaben, Ziffern oder Bindestriche."
  }
}
