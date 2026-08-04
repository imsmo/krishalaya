# infra/terraform/modules/secrets/variables.tf · KMS CMK + Secrets Manager containers

variable "name" {
  type        = string
  description = "Name prefix (e.g. krishalaya-prod)."
}

variable "generated_secret_length" {
  description = "Length for auto-generated internal secrets (JWT, s2s shared secret)."
  type        = number
  default     = 48
}

variable "external_secret_names" {
  description = "Names of secrets whose VALUES you populate manually after apply (provider keys). TF creates the empty container and never overwrites the value."
  type        = list(string)
  default = [
    "razorpay/key_id",
    "razorpay/key_secret",
    "razorpay/webhook_secret",
    "sms/provider_api_key",
    "sms/dlt_sender_id",
    "ekyc/provider_api_key",
    "weather/provider_api_key",
    "ai/model_provider_api_key",
    "push/expo_access_token",
  ]
}

variable "recovery_window_days" {
  description = "Secrets Manager deletion recovery window. 0 only for throwaway envs."
  type        = number
  default     = 14
}

variable "tags" {
  type    = map(string)
  default = {}
}
