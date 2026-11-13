terraform {
  required_version = ">= 1.15.0"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.28"
    }
  }
}

provider "cloudflare" {
  # Token from CLOUDFLARE_API_TOKEN. Needs: Workers KV Storage Edit,
  # Workers Scripts Edit, Access: Apps and Policies Edit, Access: Service Tokens Edit.
}
