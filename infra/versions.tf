terraform {
  required_version = ">= 1.17.2, < 1.18.0"
  required_providers {
    cloudfoundry = {
      source  = "cloudfoundry/cloudfoundry"
      version = "1.18.0"
    }
  }
}

# Uses the operator's existing CF CLI login. No credentials in source or tfvars.
provider "cloudfoundry" {}
