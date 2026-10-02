#!/usr/bin/env bash
# Reproducible deploy with the plain aws CLI. Usage: ./deploy.sh [backend|web|all]
# Needs: aws CLI authenticated to account 854924711083, node 22+, zip, ../../.env with sandbox PayPal creds.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ../../.env; set +a
REGION=us-east-1; ACCOUNT=854924711083; NAME=prepice
ROLE=$NAME-lambda; FN=$NAME-api; TABLE=$NAME
BUCKET=$NAME-web-$ACCOUNT
STATE=.deploy-state.json   # URLs written here (gitignored)
what=${1:-all}

backend() {
  echo "== DynamoDB"
  aws dynamodb describe-table --table-name $TABLE --region $REGION >/dev/null 2>&1 || {
    aws dynamodb create-table --table-name $TABLE --region $REGION --billing-mode PAY_PER_REQUEST \
      --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S \
      --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE >/dev/null
    aws dynamodb wait table-exists --table-name $TABLE --region $REGION
    aws dynamodb update-time-to-live --table-name $TABLE --region $REGION --time-to-live-specification Enabled=true,AttributeName=expires >/dev/null
  }
  echo "== IAM role"
  if ! aws iam get-role --role-name $ROLE >/dev/null 2>&1; then
    aws iam create-role --role-name $ROLE --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
    sleep 8
  fi
  aws iam attach-role-policy --role-name $ROLE --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  aws iam put-role-policy --role-name $ROLE --policy-name app --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[
    {\"Effect\":\"Allow\",\"Action\":[\"dynamodb:GetItem\",\"dynamodb:PutItem\",\"dynamodb:UpdateItem\",\"dynamodb:Query\"],\"Resource\":\"arn:aws:dynamodb:$REGION:$ACCOUNT:table/$TABLE\"},
    {\"Effect\":\"Allow\",\"Action\":[\"bedrock:InvokeModel\",\"bedrock:InvokeModelWithResponseStream\"],\"Resource\":[\"arn:aws:bedrock:*:$ACCOUNT:inference-profile/*anthropic.claude-sonnet-4-5-20250929-v1:0\",\"arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0\"]}]}"
  echo "== package"
  rm -f /tmp/$NAME.zip
  (cd lambda && zip -qr /tmp/$NAME.zip handler.mjs paypal.mjs store.mjs extract.mjs scan.mjs agent.mjs procedures.mjs policy.mjs catalog.mjs seed package.json)
  ls -la /tmp/$NAME.zip
  SITE=$(jq -r '.site // "https://example.com"' $STATE 2>/dev/null || echo https://example.com)
  ENVJSON=$(jq -nc --arg a "$PAYPAL_CLIENT_ID" --arg b "$PAYPAL_SECRET" --arg c "$PAYPAL_API" --arg d "$BEDROCK_MODEL" --arg e "$TABLE" --arg s "$SITE" \
    '{Variables:{PAYPAL_CLIENT_ID:$a,PAYPAL_SECRET:$b,PAYPAL_API:$c,BEDROCK_MODEL:$d,TABLE:$e,SITE_URL:$s,NODE_OPTIONS:"--enable-source-maps"}}')
  echo "== Lambda"
  ROLE_ARN=arn:aws:iam::$ACCOUNT:role/$ROLE
  if aws lambda get-function --function-name $FN --region $REGION >/dev/null 2>&1; then
    aws lambda update-function-code --function-name $FN --region $REGION --zip-file fileb:///tmp/$NAME.zip >/dev/null
    aws lambda wait function-updated --function-name $FN --region $REGION
    aws lambda update-function-configuration --function-name $FN --region $REGION --environment "$ENVJSON" --timeout 900 --memory-size 1024 >/dev/null
  else
    aws lambda create-function --function-name $FN --region $REGION --runtime nodejs22.x --handler handler.handler --role $ROLE_ARN \
      --zip-file fileb:///tmp/$NAME.zip --timeout 900 --memory-size 1024 --environment "$ENVJSON" >/dev/null
  fi
  aws lambda wait function-updated --function-name $FN --region $REGION
  echo "== Function URL"
  if ! aws lambda get-function-url-config --function-name $FN --region $REGION >/dev/null 2>&1; then
    aws lambda create-function-url-config --function-name $FN --region $REGION --auth-type NONE --invoke-mode RESPONSE_STREAM \
      --cors '{"AllowOrigins":["*"],"AllowMethods":["GET","POST"],"AllowHeaders":["content-type"],"MaxAge":3600}' >/dev/null
    aws lambda add-permission --function-name $FN --region $REGION --statement-id url-public --action lambda:InvokeFunctionUrl --principal '*' --function-url-auth-type NONE >/dev/null
    aws lambda add-permission --function-name $FN --region $REGION --statement-id url-public-invoke --action lambda:InvokeFunction --principal '*' >/dev/null  # since Oct 2025 URLs need both statements; aws-cli 2.27 lacks the --invoked-via-function-url condition flag, so this one is unconditioned
  fi
  aws lambda update-function-url-config --function-name $FN --region $REGION --invoke-mode RESPONSE_STREAM >/dev/null
  API=$(aws lambda get-function-url-config --function-name $FN --region $REGION --query FunctionUrl --output text)
  API=${API%/}
  jq -nc --arg api "$API" --argjson old "$(cat $STATE 2>/dev/null || echo '{}')" '$old + {api:$api}' > $STATE
  echo "API: $API"
}

web() {
  API=$(jq -r .api $STATE)
  echo "== build web (API=$API)"
  node scripts/build-catalog.mjs; (cd web && npm install --silent && VITE_API="$API" npm run build)
  echo "== S3 + CloudFront"
  aws s3api head-bucket --bucket $BUCKET 2>/dev/null || {
    aws s3api create-bucket --bucket $BUCKET --region $REGION >/dev/null
    aws s3api put-public-access-block --bucket $BUCKET --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  }
  OAC=$(aws cloudfront list-origin-access-controls --query "OriginAccessControlList.Items[?Name=='$NAME-oac'].Id | [0]" --output text)
  if [ "$OAC" = "None" ] || [ -z "$OAC" ]; then
    OAC=$(aws cloudfront create-origin-access-control --origin-access-control-config "Name=$NAME-oac,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3" --query OriginAccessControl.Id --output text)
  fi
  DIST=$(jq -r '.dist // empty' $STATE 2>/dev/null || true)
  if [ -z "$DIST" ]; then
    CFG=$(jq -nc --arg b "$BUCKET.s3.$REGION.amazonaws.com" --arg oac "$OAC" --arg ref "$NAME-$(date +%s)" '{
      CallerReference:$ref, Comment:"pre-price", Enabled:true, DefaultRootObject:"index.html", PriceClass:"PriceClass_100",
      Origins:{Quantity:1,Items:[{Id:"s3",DomainName:$b,OriginAccessControlId:$oac,S3OriginConfig:{OriginAccessIdentity:""}}]},
      DefaultCacheBehavior:{TargetOriginId:"s3",ViewerProtocolPolicy:"redirect-to-https",Compress:true,CachePolicyId:"658327ea-f89d-4fab-a63d-7e88639e58f6",AllowedMethods:{Quantity:2,Items:["GET","HEAD"]}},
      CustomErrorResponses:{Quantity:1,Items:[{ErrorCode:403,ResponsePagePath:"/index.html",ResponseCode:"200",ErrorCachingMinTTL:10}]}}')
    OUT=$(aws cloudfront create-distribution --distribution-config "$CFG")
    DIST=$(echo "$OUT" | jq -r .Distribution.Id); DOM=$(echo "$OUT" | jq -r .Distribution.DomainName)
    jq -nc --arg d "$DIST" --arg dom "$DOM" --argjson old "$(cat $STATE)" '$old + {dist:$d, site:("https://"+$dom)}' > $STATE
    aws s3api put-bucket-policy --bucket $BUCKET --policy "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"cloudfront.amazonaws.com\"},\"Action\":\"s3:GetObject\",\"Resource\":\"arn:aws:s3:::$BUCKET/*\",\"Condition\":{\"StringEquals\":{\"AWS:SourceArn\":\"arn:aws:cloudfront::$ACCOUNT:distribution/$DIST\"}}}]}"
  fi
  aws s3 sync web/dist s3://$BUCKET --delete --cache-control "public,max-age=300" >/dev/null
  aws s3 cp web/dist/index.html s3://$BUCKET/index.html --cache-control "no-cache" >/dev/null
  aws cloudfront create-invalidation --distribution-id $DIST --paths '/*' >/dev/null
  echo "SITE: $(jq -r .site $STATE)"
}

case $what in backend) backend;; web) web;; all) backend; web; backend;; esac
cat $STATE
