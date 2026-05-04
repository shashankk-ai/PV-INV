#!/usr/bin/env bash
# =============================================================================
# LITMUS — AWS Infrastructure Setup Script
# =============================================================================
# Run this ONCE to provision all AWS resources needed to run LITMUS on EC2.
# After this script succeeds, copy the printed values into GitHub Actions
# secrets (Settings → Secrets → Actions) and push to main to trigger deploy.
#
# Prerequisites:
#   - AWS CLI installed and configured (aws configure)
#   - IAM user/role with: EC2, RDS, ECR, S3, IAM full access
#
# Usage:
#   chmod +x aws-setup.sh
#   ./aws-setup.sh
#   # Optionally override defaults:
#   APP=myapp REGION=us-east-1 ./aws-setup.sh
# =============================================================================

set -euo pipefail

# ── Config (override via env vars) ──────────────────────────────────────────
APP="${APP:-litmus}"
REGION="${REGION:-ap-south-1}"
EC2_INSTANCE_TYPE="${EC2_INSTANCE_TYPE:-t3.small}"
RDS_INSTANCE_TYPE="${RDS_INSTANCE_TYPE:-db.t3.micro}"
DB_NAME="${DB_NAME:-litmus_db}"
DB_USER="${DB_USER:-litmus}"
DB_PASS="${DB_PASS:-$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 24)}"
KEY_NAME="${KEY_NAME:-${APP}-key}"
ECR_REPO="${ECR_REPO:-${APP}}"
S3_BUCKET="${S3_BUCKET:-${APP}-photos-prod}"

PASS=0; FAIL=0
ok()   { echo "  [OK]   $*"; ((PASS++)) || true; }
fail() { echo "  [FAIL] $*"; ((FAIL++)) || true; }
step() { echo; echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; echo "  $*"; echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; }

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

echo
echo "  LITMUS AWS Setup"
echo "  Account : $ACCOUNT_ID"
echo "  Region  : $REGION"
echo "  App     : $APP"
echo

# ── 1. ECR Repository ────────────────────────────────────────────────────────
step "1. ECR Repository"
if aws ecr describe-repositories --repository-names "$ECR_REPO" --region "$REGION" &>/dev/null; then
  ok "ECR repo '$ECR_REPO' already exists"
else
  aws ecr create-repository \
    --repository-name "$ECR_REPO" \
    --image-scanning-configuration scanOnPush=true \
    --region "$REGION" > /dev/null
  ok "Created ECR repo: $ECR_REGISTRY/$ECR_REPO"
fi

# Lifecycle: keep only last 10 images
aws ecr put-lifecycle-policy \
  --repository-name "$ECR_REPO" \
  --region "$REGION" \
  --lifecycle-policy-text '{
    "rules":[{"rulePriority":1,"description":"Keep last 10","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":10},"action":{"type":"expire"}}]
  }' > /dev/null 2>&1 || true
ok "Lifecycle policy set (keep last 10 images)"

# ── 2. S3 Bucket for Photos ───────────────────────────────────────────────────
step "2. S3 Bucket ($S3_BUCKET)"
if aws s3api head-bucket --bucket "$S3_BUCKET" --region "$REGION" 2>/dev/null; then
  ok "S3 bucket '$S3_BUCKET' already exists"
else
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$S3_BUCKET" --region "$REGION" > /dev/null
  else
    aws s3api create-bucket --bucket "$S3_BUCKET" --region "$REGION" \
      --create-bucket-configuration LocationConstraint="$REGION" > /dev/null
  fi
  ok "Created S3 bucket: $S3_BUCKET"
fi

# Block all public access
aws s3api put-public-access-block --bucket "$S3_BUCKET" \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" > /dev/null
ok "S3 public access blocked (use CloudFront for serving)"

# CORS for browser uploads
aws s3api put-bucket-cors --bucket "$S3_BUCKET" --cors-configuration '{
  "CORSRules":[{
    "AllowedOrigins":["*"],
    "AllowedMethods":["GET","PUT","POST"],
    "AllowedHeaders":["*"],
    "MaxAgeSeconds":3600
  }]
}' > /dev/null
ok "CORS configured"

# ── 3. VPC + Security Groups ──────────────────────────────────────────────────
step "3. VPC & Security Groups"

VPC_ID=$(aws ec2 describe-vpcs \
  --filters "Name=is-default,Values=true" \
  --query "Vpcs[0].VpcId" --output text --region "$REGION")
ok "Using default VPC: $VPC_ID"

# EC2 Security Group
EC2_SG=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=${APP}-ec2-sg" "Name=vpc-id,Values=$VPC_ID" \
  --query "SecurityGroups[0].GroupId" --output text --region "$REGION" 2>/dev/null)

if [ "$EC2_SG" = "None" ] || [ -z "$EC2_SG" ]; then
  EC2_SG=$(aws ec2 create-security-group \
    --group-name "${APP}-ec2-sg" \
    --description "LITMUS EC2 — HTTP + SSH" \
    --vpc-id "$VPC_ID" \
    --region "$REGION" \
    --query "GroupId" --output text)
  aws ec2 authorize-security-group-ingress --group-id "$EC2_SG" --region "$REGION" \
    --ip-permissions \
      "IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}]" \
      "IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}]" \
      "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=0.0.0.0/0}]" > /dev/null
  ok "Created EC2 security group: $EC2_SG"
else
  ok "EC2 security group already exists: $EC2_SG"
fi

# RDS Security Group
RDS_SG=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=${APP}-rds-sg" "Name=vpc-id,Values=$VPC_ID" \
  --query "SecurityGroups[0].GroupId" --output text --region "$REGION" 2>/dev/null)

if [ "$RDS_SG" = "None" ] || [ -z "$RDS_SG" ]; then
  RDS_SG=$(aws ec2 create-security-group \
    --group-name "${APP}-rds-sg" \
    --description "LITMUS RDS — Postgres from EC2" \
    --vpc-id "$VPC_ID" \
    --region "$REGION" \
    --query "GroupId" --output text)
  aws ec2 authorize-security-group-ingress --group-id "$RDS_SG" --region "$REGION" \
    --ip-permissions \
      "IpProtocol=tcp,FromPort=5432,ToPort=5432,UserIdGroupPairs=[{GroupId=${EC2_SG}}]" > /dev/null
  ok "Created RDS security group: $RDS_SG (allows port 5432 from EC2 SG)"
else
  ok "RDS security group already exists: $RDS_SG"
fi

# ── 4. RDS PostgreSQL ─────────────────────────────────────────────────────────
step "4. RDS PostgreSQL ($RDS_INSTANCE_TYPE)"

RDS_ID="${APP}-db"
RDS_STATUS=$(aws rds describe-db-instances \
  --db-instance-identifier "$RDS_ID" \
  --query "DBInstances[0].DBInstanceStatus" --output text --region "$REGION" 2>/dev/null || echo "MISSING")

if [ "$RDS_STATUS" = "MISSING" ]; then
  aws rds create-db-instance \
    --db-instance-identifier "$RDS_ID" \
    --db-instance-class "$RDS_INSTANCE_TYPE" \
    --engine postgres \
    --engine-version "15" \
    --db-name "$DB_NAME" \
    --master-username "$DB_USER" \
    --master-user-password "$DB_PASS" \
    --allocated-storage 20 \
    --storage-type gp2 \
    --no-multi-az \
    --no-publicly-accessible \
    --vpc-security-group-ids "$RDS_SG" \
    --backup-retention-period 7 \
    --deletion-protection \
    --region "$REGION" > /dev/null
  ok "RDS instance '$RDS_ID' creation started (takes ~5 min)"
  echo "  Waiting for RDS to become available…"
  aws rds wait db-instance-available \
    --db-instance-identifier "$RDS_ID" --region "$REGION"
  ok "RDS instance available"
else
  ok "RDS '$RDS_ID' already exists (status: $RDS_STATUS)"
fi

RDS_ENDPOINT=$(aws rds describe-db-instances \
  --db-instance-identifier "$RDS_ID" \
  --query "DBInstances[0].Endpoint.Address" --output text --region "$REGION")
ok "RDS endpoint: $RDS_ENDPOINT"

DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${RDS_ENDPOINT}:5432/${DB_NAME}?sslmode=require"

# ── 5. EC2 Key Pair ───────────────────────────────────────────────────────────
step "5. EC2 Key Pair"

if aws ec2 describe-key-pairs --key-names "$KEY_NAME" --region "$REGION" &>/dev/null; then
  ok "Key pair '$KEY_NAME' already exists"
  echo "  NOTE: If you don't have the .pem file, delete and re-create this key pair."
else
  aws ec2 create-key-pair \
    --key-name "$KEY_NAME" \
    --region "$REGION" \
    --query "KeyMaterial" --output text > "${KEY_NAME}.pem"
  chmod 400 "${KEY_NAME}.pem"
  ok "Created key pair → ${KEY_NAME}.pem  (SAVE THIS FILE)"
fi

# ── 6. EC2 Instance ───────────────────────────────────────────────────────────
step "6. EC2 Instance ($EC2_INSTANCE_TYPE)"

EC2_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=${APP}-server" "Name=instance-state-name,Values=running,stopped,pending" \
  --query "Reservations[0].Instances[0].InstanceId" --output text --region "$REGION" 2>/dev/null)

if [ "$EC2_ID" = "None" ] || [ -z "$EC2_ID" ]; then
  # Amazon Linux 2023 AMI (latest in ap-south-1)
  AMI_ID=$(aws ec2 describe-images \
    --owners amazon \
    --filters "Name=name,Values=al2023-ami-*-x86_64" "Name=state,Values=available" \
    --query "reverse(sort_by(Images,&CreationDate))[0].ImageId" \
    --output text --region "$REGION")

  EC2_ID=$(aws ec2 run-instances \
    --image-id "$AMI_ID" \
    --instance-type "$EC2_INSTANCE_TYPE" \
    --key-name "$KEY_NAME" \
    --security-group-ids "$EC2_SG" \
    --region "$REGION" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${APP}-server}]" \
    --user-data '#!/bin/bash
      dnf update -y
      dnf install -y docker
      systemctl enable docker
      systemctl start docker
      usermod -aG docker ec2-user
      # Redis
      dnf install -y redis6 || dnf install -y redis
      systemctl enable redis6 || systemctl enable redis
      systemctl start redis6 || systemctl start redis
      # AWS CLI v2
      curl -s "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
      unzip -q /tmp/awscliv2.zip -d /tmp && /tmp/aws/install
    ' \
    --query "Instances[0].InstanceId" --output text)
  ok "Launched EC2 instance: $EC2_ID"
  echo "  Waiting for instance to be running…"
  aws ec2 wait instance-running --instance-ids "$EC2_ID" --region "$REGION"
  ok "EC2 instance running"
else
  ok "EC2 instance already exists: $EC2_ID"
fi

EC2_IP=$(aws ec2 describe-instances \
  --instance-ids "$EC2_ID" \
  --query "Reservations[0].Instances[0].PublicIpAddress" --output text --region "$REGION")
ok "EC2 public IP: $EC2_IP"

# ── 7. IAM Deploy User ────────────────────────────────────────────────────────
step "7. IAM Deploy User (for GitHub Actions)"

IAM_USER="${APP}-deployer"
if aws iam get-user --user-name "$IAM_USER" &>/dev/null; then
  ok "IAM user '$IAM_USER' already exists"
else
  aws iam create-user --user-name "$IAM_USER" > /dev/null

  # Inline policy: ECR push + S3 read/write + RDS describe
  aws iam put-user-policy \
    --user-name "$IAM_USER" \
    --policy-name "${APP}-deploy-policy" \
    --policy-document "{
      \"Version\": \"2012-10-17\",
      \"Statement\": [
        {
          \"Effect\": \"Allow\",
          \"Action\": [
            \"ecr:GetAuthorizationToken\",
            \"ecr:BatchCheckLayerAvailability\",
            \"ecr:GetDownloadUrlForLayer\",
            \"ecr:BatchGetImage\",
            \"ecr:InitiateLayerUpload\",
            \"ecr:UploadLayerPart\",
            \"ecr:CompleteLayerUpload\",
            \"ecr:PutImage\",
            \"ecr:DescribeRepositories\"
          ],
          \"Resource\": \"*\"
        },
        {
          \"Effect\": \"Allow\",
          \"Action\": [\"s3:PutObject\",\"s3:GetObject\",\"s3:DeleteObject\",\"s3:ListBucket\"],
          \"Resource\": [
            \"arn:aws:s3:::${S3_BUCKET}\",
            \"arn:aws:s3:::${S3_BUCKET}/*\"
          ]
        },
        {
          \"Effect\": \"Allow\",
          \"Action\": [\"rds:DescribeDBInstances\"],
          \"Resource\": \"*\"
        },
        {
          \"Effect\": \"Allow\",
          \"Action\": [\"sts:GetCallerIdentity\"],
          \"Resource\": \"*\"
        }
      ]
    }" > /dev/null

  KEYS=$(aws iam create-access-key --user-name "$IAM_USER" --output json)
  DEPLOY_KEY_ID=$(echo "$KEYS" | python3 -c "import sys,json; d=json.load(sys.stdin)['AccessKey']; print(d['AccessKeyId'])")
  DEPLOY_SECRET=$(echo "$KEYS" | python3 -c "import sys,json; d=json.load(sys.stdin)['AccessKey']; print(d['SecretAccessKey'])")
  ok "Created IAM user '$IAM_USER' with access keys"
fi

# ── 8. SSH Key for GitHub Actions ─────────────────────────────────────────────
step "8. EC2 SSH Key (for GitHub Actions)"

if [ -f "${KEY_NAME}.pem" ]; then
  ok "SSH private key found at ${KEY_NAME}.pem"
  EC2_SSH_KEY=$(cat "${KEY_NAME}.pem")
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo
echo "╔══════════════════════════════════════════════════════════════╗"
echo "  SETUP COMPLETE — PASSED: $PASS  FAILED: $FAIL"
echo "╚══════════════════════════════════════════════════════════════╝"
echo
echo "Add these as GitHub Actions Secrets"
echo "(Settings → Secrets and variables → Actions → New repository secret)"
echo
echo "  AWS_ACCESS_KEY_ID     = ${DEPLOY_KEY_ID:-<from IAM user already existed>}"
echo "  AWS_SECRET_ACCESS_KEY = ${DEPLOY_SECRET:-<from IAM user already existed>}"
echo "  EC2_HOST              = $EC2_IP"
echo "  EC2_SSH_KEY           = <contents of ${KEY_NAME}.pem>"
echo "  DB_PASS               = $DB_PASS"
echo "  JWT_ACCESS_SECRET     = $(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 48)"
echo "  JWT_REFRESH_SECRET    = $(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 48)"
echo
echo "Optional secrets (email + CDN):"
echo "  SMTP_HOST             = smtp.gmail.com"
echo "  SMTP_PORT             = 587"
echo "  SMTP_USER             = your@email.com"
echo "  SMTP_PASS             = <app password>"
echo "  SMTP_FROM             = LITMUS <noreply@yourdomain.com>"
echo "  CLOUDFRONT_URL        = https://dXXXXXXXXXXXX.cloudfront.net"
echo
echo "Update the ECR registry + RDS endpoint in deploy.yml:"
echo "  REGISTRY   = $ECR_REGISTRY"
echo "  RDS host   = $RDS_ENDPOINT"
echo
echo "Verify EC2 is reachable:"
echo "  ssh -i ${KEY_NAME}.pem ec2-user@$EC2_IP"
echo

[ "$FAIL" -gt 0 ] && exit 1 || exit 0
