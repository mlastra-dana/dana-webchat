#!/usr/bin/env bash
set -euo pipefail

backend_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
region="us-east-1"
function_name="dana-webchat-api"
role_name="dana-webchat-api-role-oiw6vs8o"
account_id="905418296062"
bucket_name="dana-webchat-receipts-${account_id}-${region}"
temporary_dir="$(mktemp -d)"
trap 'rm -rf "$temporary_dir"' EXIT
chmod 700 "$temporary_dir"

python3 -m unittest discover -s "$backend_dir" -p 'test_*.py'
python3 -m py_compile "$backend_dir/lambda_function.py"

if ! aws s3api head-bucket --bucket "$bucket_name" --expected-bucket-owner "$account_id" --region "$region" >/dev/null 2>&1; then
  aws s3api create-bucket --bucket "$bucket_name" --region "$region" >/dev/null
fi
aws s3api put-public-access-block --bucket "$bucket_name" --region "$region" --public-access-block-configuration 'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'
aws s3api put-bucket-ownership-controls --bucket "$bucket_name" --region "$region" --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
aws s3api put-bucket-encryption --bucket "$bucket_name" --region "$region" --server-side-encryption-configuration 'Rules=[{ApplyServerSideEncryptionByDefault={SSEAlgorithm=AES256}}]'
aws s3api put-bucket-cors --bucket "$bucket_name" --region "$region" --cors-configuration "file://$backend_dir/aws/media-cors.json"
aws iam put-role-policy --role-name "$role_name" --policy-name DANAWebChatMediaAccess --policy-document "file://$backend_dir/aws/media-iam-policy.json"

aws lambda get-function-configuration --function-name "$function_name" --region "$region" > "$temporary_dir/current.json"
python3 - "$temporary_dir/current.json" "$temporary_dir/environment.json" "$bucket_name" <<'PY'
import json
import sys

source, destination, bucket = sys.argv[1:]
with open(source, encoding="utf-8") as handle:
    variables = json.load(handle)["Environment"]["Variables"]
variables.update({
    "MEDIA_BUCKET": bucket,
    "MEDIA_PREFIX": "receipts",
    "MEDIA_MAX_BYTES": str(10 * 1024 * 1024),
    "MEDIA_URL_TTL_SECONDS": "900",
    "RECEIPT_CONFIDENCE_THRESHOLD": "0.85",
})
with open(destination, "w", encoding="utf-8") as handle:
    json.dump({"Variables": variables}, handle)
PY
chmod 600 "$temporary_dir/environment.json"
aws lambda update-function-configuration --function-name "$function_name" --region "$region" --timeout 60 --memory-size 256 --environment "file://$temporary_dir/environment.json" >/dev/null
aws lambda wait function-updated --function-name "$function_name" --region "$region"

(cd "$backend_dir" && zip -q "$temporary_dir/dana-webchat-api.zip" lambda_function.py)
aws lambda update-function-code --function-name "$function_name" --region "$region" --zip-file "fileb://$temporary_dir/dana-webchat-api.zip" >/dev/null
aws lambda wait function-updated --function-name "$function_name" --region "$region"
aws lambda get-function-configuration --function-name "$function_name" --region "$region" --query '{FunctionName:FunctionName,LastModified:LastModified,CodeSha256:CodeSha256,Timeout:Timeout,MemorySize:MemorySize}' --output json
