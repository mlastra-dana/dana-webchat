#!/usr/bin/env bash
set -euo pipefail

backend_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
region="us-east-1"
function_name="dana-webchat-api"
role_name="dana-webchat-api-role-oiw6vs8o"
account_id="905418296062"
temporary_dir="$(mktemp -d)"
trap 'rm -rf "$temporary_dir"' EXIT
chmod 700 "$temporary_dir"

python3 -m py_compile "$backend_dir/lambda_function.py"
caller_account="$(aws sts get-caller-identity --query Account --output text)"
if [[ "$caller_account" != "$account_id" ]]; then
  echo "Cuenta AWS inesperada: $caller_account" >&2
  exit 1
fi

aws iam get-role-policy --role-name "$role_name" --policy-name DANALinkChatChimeSDKAccess >/dev/null
aws iam get-role-policy --role-name "$role_name" --policy-name DANALinkChatS3MediaAccess >/dev/null
aws lambda get-function-configuration --function-name "$function_name" --region "$region" > "$temporary_dir/current.json"

python3 - "$temporary_dir/current.json" "$temporary_dir/environment.json" <<'PY'
import json
import sys

source, destination = sys.argv[1:]
with open(source, encoding="utf-8") as handle:
    configuration = json.load(handle)
variables = configuration.get("Environment", {}).get("Variables", {})
if variables.get("MEDIA_BUCKET") != "dc-files-vzla-demo":
    raise SystemExit("MEDIA_BUCKET no coincide con el bucket existente del proyecto")
if variables.get("CHIME_MEDIA_REGION") != "us-east-1":
    raise SystemExit("CHIME_MEDIA_REGION debe ser us-east-1 para este despliegue")
variables.update({
    "MEDIA_PREFIX": "dana-linkchat",
    "MEDIA_MAX_BYTES": str(10 * 1024 * 1024),
    "MEDIA_URL_TTL_SECONDS": "900",
    "RECEIPT_CONFIDENCE_THRESHOLD": "0.85",
})
with open(destination, "w", encoding="utf-8") as handle:
    json.dump({"Variables": variables}, handle)
PY
chmod 600 "$temporary_dir/environment.json"

revision_id="$(python3 - "$temporary_dir/current.json" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    print(json.load(handle)["RevisionId"])
PY
)"
aws lambda update-function-configuration --function-name "$function_name" --region "$region" --revision-id "$revision_id" --timeout 60 --memory-size 256 --environment "file://$temporary_dir/environment.json" >/dev/null
aws lambda wait function-updated --function-name "$function_name" --region "$region"

(cd "$backend_dir" && zip -q "$temporary_dir/dana-webchat-api.zip" lambda_function.py)
revision_id="$(aws lambda get-function-configuration --function-name "$function_name" --region "$region" --query RevisionId --output text)"
aws lambda update-function-code --function-name "$function_name" --region "$region" --revision-id "$revision_id" --zip-file "fileb://$temporary_dir/dana-webchat-api.zip" >/dev/null
aws lambda wait function-updated --function-name "$function_name" --region "$region"
aws lambda get-function-configuration --function-name "$function_name" --region "$region" --query '{FunctionName:FunctionName,LastModified:LastModified,CodeSha256:CodeSha256,Timeout:Timeout,MemorySize:MemorySize,LastUpdateStatus:LastUpdateStatus}' --output json
