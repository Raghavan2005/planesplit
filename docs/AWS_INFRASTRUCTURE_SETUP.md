# AWS Infrastructure Setup — Optional, Documentation-Only Runbook

> ## STATUS BANNER — READ FIRST
> **This document is not connected to the PS31 simulator in any way.** `planesplit/`, `backend/`, and `frontend/` are a deterministic, in-memory, pure-software simulation (`docs/DECISION.md`, `docs/ARCHITECTURE.md §5`) and stay that way. Nothing below is executed, wired in, imported, or referenced by any code in this repository — it is a **raw AWS CLI runbook**, written for a possible future real-infrastructure layer, kept entirely separate so the tested simulator is never put at risk by an unrelated cloud-deployment concern.
>
> **Running any command in this document costs real money** (NAT Gateways, EC2 instances, ALBs, and Global Accelerator all bill hourly plus data-processing charges, regardless of traffic). Nothing here has been executed as part of writing this document — treat every command as unverified against a live account until you run it yourself, in a sandboxed/test AWS account, and read the cost warning in the Prerequisites section below.
>
> For the conceptual, not-yet-built recommendation/AI layer this infrastructure would eventually carry, see `docs/FUTURE_VISION.md`. For why the project chose pure simulation over real infrastructure in the first place, see `docs/DECISION.md` and `docs/ARCHITECTURE.md §5`.
>
> **No Terraform or CloudFormation.** Every step below is a raw `aws` CLI invocation, on purpose — this is meant to be read and run command-by-command by a human, not applied as a single opaque stack.

---

## 1. Prerequisites checklist

Before running anything in Section 3:

- [ ] **A dedicated AWS account** (ideally a sandbox/test account, not a production account) with billing/budget alerts already configured. This project recommends setting an AWS Budgets alert (e.g. $20/day) before creating any resource below.
- [ ] **Least-privilege IAM.** Do not use root credentials. Create (or have created for you) an IAM user or role scoped to only the services this runbook touches: `ec2:*` (VPC/subnets/IGW/NAT/route tables/security groups/instances), `elasticloadbalancing:*` (target groups/ALB), `globalaccelerator:*`. Do not attach `AdministratorAccess` for this exercise.
- [ ] **AWS CLI v2 installed and configured** — verify with `aws --version` (must report `aws-cli/2.x`) and `aws sts get-caller-identity` (must return the intended account, not an unexpected one).
- [ ] **An EC2 key pair** already created in each region you'll deploy to, or created in Section 3 Step 8 below.
- [ ] **Two target regions chosen** for the multi-region section (this runbook uses `us-east-1` and `us-west-2` as examples — substitute your own).
- [ ] **Cost warning acknowledged**: a NAT Gateway alone bills ~$0.045/hr + data processing *per region* even fully idle; a Global Accelerator adds a further fixed hourly charge on top of ALB/EC2 costs. Tearing down promptly (Section 5) matters.
- [ ] **jq installed** (used in this runbook's examples to extract IDs from `aws ... --output json` responses; `--query` + `--output text` is used as the primary mechanism so this works even without `jq`, with `jq` shown as an alternative).

---

## 2. Naming and variable conventions used below

Every command below assumes these shell variables are set first, and captures resource IDs into new variables as it goes so later steps never hardcode an ID typed by hand. Two full passes are shown: `REGION_A=us-east-1` (Sections 3.1–3.10) and `REGION_B=us-west-2` (Section 3.11, mirroring 3.1–3.9). Nothing in Section 3.11 depends on anything created only in `REGION_A` — VPC, subnets, and security groups are per-region resources in AWS and must be created independently in each region; only the Global Accelerator (Section 3.12) spans both.

```bash
export REGION_A=us-east-1
export REGION_B=us-west-2
export PROJECT_TAG=ps31-infra-demo
export KEY_NAME=ps31-demo-key
```

---

## 3. Step-by-step setup (Region A: `us-east-1`)

Commands are ordered so each one only references IDs already captured by an earlier step — read linearly, top to bottom.

### 3.1 VPC

```bash
VPC_ID=$(aws ec2 create-vpc \
  --region $REGION_A \
  --cidr-block 10.0.0.0/16 \
  --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=$PROJECT_TAG-vpc-a}]" \
  --query 'Vpc.VpcId' --output text)

aws ec2 modify-vpc-attribute --region $REGION_A --vpc-id $VPC_ID --enable-dns-support
aws ec2 modify-vpc-attribute --region $REGION_A --vpc-id $VPC_ID --enable-dns-hostnames
```

### 3.2 Public and private subnets

```bash
PUBLIC_SUBNET_ID=$(aws ec2 create-subnet \
  --region $REGION_A --vpc-id $VPC_ID \
  --cidr-block 10.0.1.0/24 --availability-zone ${REGION_A}a \
  --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$PROJECT_TAG-public-a}]" \
  --query 'Subnet.SubnetId' --output text)

PRIVATE_SUBNET_ID=$(aws ec2 create-subnet \
  --region $REGION_A --vpc-id $VPC_ID \
  --cidr-block 10.0.2.0/24 --availability-zone ${REGION_A}a \
  --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$PROJECT_TAG-private-a}]" \
  --query 'Subnet.SubnetId' --output text)

# A second public subnet in a second AZ is required later — an ALB needs
# subnets in at least 2 AZs.
PUBLIC_SUBNET_ID_2=$(aws ec2 create-subnet \
  --region $REGION_A --vpc-id $VPC_ID \
  --cidr-block 10.0.3.0/24 --availability-zone ${REGION_A}b \
  --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$PROJECT_TAG-public-a2}]" \
  --query 'Subnet.SubnetId' --output text)

aws ec2 modify-subnet-attribute --region $REGION_A --subnet-id $PUBLIC_SUBNET_ID --map-public-ip-on-launch
aws ec2 modify-subnet-attribute --region $REGION_A --subnet-id $PUBLIC_SUBNET_ID_2 --map-public-ip-on-launch
```

### 3.3 Internet Gateway

```bash
IGW_ID=$(aws ec2 create-internet-gateway \
  --region $REGION_A \
  --tag-specifications "ResourceType=internet-gateway,Tags=[{Key=Name,Value=$PROJECT_TAG-igw-a}]" \
  --query 'InternetGateway.InternetGatewayId' --output text)

aws ec2 attach-internet-gateway --region $REGION_A --vpc-id $VPC_ID --internet-gateway-id $IGW_ID
```

### 3.4 NAT Gateway (for the private subnet's outbound access)

```bash
NAT_EIP_ALLOC_ID=$(aws ec2 allocate-address --region $REGION_A --domain vpc --query 'AllocationId' --output text)

NAT_GW_ID=$(aws ec2 create-nat-gateway \
  --region $REGION_A \
  --subnet-id $PUBLIC_SUBNET_ID \
  --allocation-id $NAT_EIP_ALLOC_ID \
  --tag-specifications "ResourceType=natgateway,Tags=[{Key=Name,Value=$PROJECT_TAG-nat-a}]" \
  --query 'NatGateway.NatGatewayId' --output text)

# NAT Gateways take a few minutes to become available — must wait before
# route tables that reference it will actually route traffic correctly.
aws ec2 wait nat-gateway-available --region $REGION_A --nat-gateway-ids $NAT_GW_ID
```

### 3.5 Route tables

```bash
# Public route table -> Internet Gateway
PUBLIC_RT_ID=$(aws ec2 create-route-table \
  --region $REGION_A --vpc-id $VPC_ID \
  --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=$PROJECT_TAG-public-rt-a}]" \
  --query 'RouteTable.RouteTableId' --output text)

aws ec2 create-route --region $REGION_A --route-table-id $PUBLIC_RT_ID \
  --destination-cidr-block 0.0.0.0/0 --gateway-id $IGW_ID

aws ec2 associate-route-table --region $REGION_A --route-table-id $PUBLIC_RT_ID --subnet-id $PUBLIC_SUBNET_ID
aws ec2 associate-route-table --region $REGION_A --route-table-id $PUBLIC_RT_ID --subnet-id $PUBLIC_SUBNET_ID_2

# Private route table -> NAT Gateway
PRIVATE_RT_ID=$(aws ec2 create-route-table \
  --region $REGION_A --vpc-id $VPC_ID \
  --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=$PROJECT_TAG-private-rt-a}]" \
  --query 'RouteTable.RouteTableId' --output text)

aws ec2 create-route --region $REGION_A --route-table-id $PRIVATE_RT_ID \
  --destination-cidr-block 0.0.0.0/0 --nat-gateway-id $NAT_GW_ID

aws ec2 associate-route-table --region $REGION_A --route-table-id $PRIVATE_RT_ID --subnet-id $PRIVATE_SUBNET_ID
```

### 3.6 Security groups

```bash
ALB_SG_ID=$(aws ec2 create-security-group \
  --region $REGION_A --vpc-id $VPC_ID \
  --group-name $PROJECT_TAG-alb-sg --description "ALB: allow inbound HTTP/HTTPS from internet" \
  --query 'GroupId' --output text)

aws ec2 authorize-security-group-ingress --region $REGION_A --group-id $ALB_SG_ID \
  --protocol tcp --port 80 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --region $REGION_A --group-id $ALB_SG_ID \
  --protocol tcp --port 443 --cidr 0.0.0.0/0

EC2_SG_ID=$(aws ec2 create-security-group \
  --region $REGION_A --vpc-id $VPC_ID \
  --group-name $PROJECT_TAG-ec2-sg --description "EC2: allow inbound HTTP only from ALB SG, SSH from admin CIDR" \
  --query 'GroupId' --output text)

aws ec2 authorize-security-group-ingress --region $REGION_A --group-id $EC2_SG_ID \
  --protocol tcp --port 80 --source-group $ALB_SG_ID
# Replace 203.0.113.0/32 with your actual admin IP/CIDR -- never 0.0.0.0/0 for SSH.
aws ec2 authorize-security-group-ingress --region $REGION_A --group-id $EC2_SG_ID \
  --protocol tcp --port 22 --cidr 203.0.113.0/32
```

### 3.7 EC2 key pair (skip if reusing an existing one)

```bash
aws ec2 create-key-pair --region $REGION_A --key-name $KEY_NAME \
  --query 'KeyMaterial' --output text > ${KEY_NAME}-${REGION_A}.pem
chmod 400 ${KEY_NAME}-${REGION_A}.pem
```

### 3.8 EC2 instance(s)

```bash
AMI_ID=$(aws ec2 describe-images --region $REGION_A --owners amazon \
  --filters "Name=name,Values=al2023-ami-*-x86_64" "Name=state,Values=available" \
  --query 'sort_by(Images, &CreationDate)[-1].ImageId' --output text)

INSTANCE_ID=$(aws ec2 run-instances \
  --region $REGION_A \
  --image-id $AMI_ID \
  --instance-type t3.micro \
  --key-name $KEY_NAME \
  --subnet-id $PRIVATE_SUBNET_ID \
  --security-group-ids $EC2_SG_ID \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$PROJECT_TAG-app-a}]" \
  --query 'Instances[0].InstanceId' --output text)

aws ec2 wait instance-running --region $REGION_A --instance-ids $INSTANCE_ID
```

### 3.9 Target group

```bash
TG_ARN=$(aws elbv2 create-target-group \
  --region $REGION_A \
  --name $PROJECT_TAG-tg-a \
  --protocol HTTP --port 80 \
  --vpc-id $VPC_ID \
  --health-check-protocol HTTP --health-check-path / \
  --target-type instance \
  --query 'TargetGroups[0].TargetGroupArn' --output text)

aws elbv2 register-targets --region $REGION_A --target-group-arn $TG_ARN \
  --targets Id=$INSTANCE_ID
```

### 3.10 Application Load Balancer

```bash
ALB_ARN=$(aws elbv2 create-load-balancer \
  --region $REGION_A \
  --name $PROJECT_TAG-alb-a \
  --type application --scheme internet-facing \
  --subnets $PUBLIC_SUBNET_ID $PUBLIC_SUBNET_ID_2 \
  --security-groups $ALB_SG_ID \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)

aws ec2 wait load-balancer-available --region $REGION_A --load-balancer-arns $ALB_ARN 2>/dev/null || \
  aws elbv2 wait load-balancer-available --region $REGION_A --load-balancer-arns $ALB_ARN

aws elbv2 create-listener \
  --region $REGION_A \
  --load-balancer-arn $ALB_ARN \
  --protocol HTTP --port 80 \
  --default-actions Type=forward,TargetGroupArn=$TG_ARN

ALB_DNS=$(aws elbv2 describe-load-balancers --region $REGION_A --load-balancer-arns $ALB_ARN \
  --query 'LoadBalancers[0].DNSName' --output text)
echo "Region A ALB DNS: $ALB_DNS"
```

---

### 3.11 Region B (`us-west-2`) — repeat 3.1–3.10 with new names

Mirror every command in Sections 3.1–3.10 with `REGION_A` replaced by `REGION_B`, a distinct non-overlapping CIDR (`10.1.0.0/16` instead of `10.0.0.0/16`), and `-b` suffixes instead of `-a` (e.g. `$PROJECT_TAG-vpc-b`, `$PROJECT_TAG-alb-b`). This produces a second, fully independent `VPC_ID_B`, `ALB_ARN_B`, `TG_ARN_B`, `ALB_DNS_B` — VPCs, subnets, and security groups are always region-scoped in AWS, so region B genuinely cannot reuse anything created in region A. Do not skip re-running the AMI lookup (Section 3.8) for region B — AMI IDs are region-specific and the region-A `AMI_ID` value is invalid in region B.

### 3.12 Global Accelerator (spans both regions — the only resource in this section that isn't per-region)

Global Accelerator is created once, in whichever region you run the CLI from (accelerators are global resources, but the CLI still targets an API endpoint — use `--region us-west-2`, the only region where the Global Accelerator API is available):

```bash
ACCEL_ARN=$(aws globalaccelerator create-accelerator \
  --region us-west-2 \
  --name $PROJECT_TAG-accelerator \
  --ip-address-type IPV4 \
  --enabled \
  --query 'Accelerator.AcceleratorArn' --output text)

aws globalaccelerator wait accelerator-deployed --region us-west-2 --accelerator-arn $ACCEL_ARN 2>/dev/null || sleep 60

LISTENER_ARN=$(aws globalaccelerator create-listener \
  --region us-west-2 \
  --accelerator-arn $ACCEL_ARN \
  --protocol TCP \
  --port-ranges FromPort=80,ToPort=80 \
  --query 'Listener.ListenerArn' --output text)

# One endpoint group per region, each pointing at that region's ALB.
aws globalaccelerator create-endpoint-group \
  --region us-west-2 \
  --listener-arn $LISTENER_ARN \
  --endpoint-group-region $REGION_A \
  --endpoint-configurations EndpointId=$ALB_ARN,Weight=100 \
  --traffic-dial-percentage 100

aws globalaccelerator create-endpoint-group \
  --region us-west-2 \
  --listener-arn $LISTENER_ARN \
  --endpoint-group-region $REGION_B \
  --endpoint-configurations EndpointId=$ALB_ARN_B,Weight=100 \
  --traffic-dial-percentage 100

ACCEL_IP=$(aws globalaccelerator describe-accelerator --region us-west-2 --accelerator-arn $ACCEL_ARN \
  --query 'Accelerator.IpSets[0].IpAddresses[0]' --output text)
echo "Global Accelerator static anycast IP: $ACCEL_IP"
```

---

## 4. Verification commands

Run these against the resources created above to confirm the chain actually works end-to-end, from the target group outward to the global anycast IP:

```bash
# 1. Confirm the EC2 instance is a healthy target behind its own ALB.
aws elbv2 describe-target-health --region $REGION_A --target-group-arn $TG_ARN
aws elbv2 describe-target-health --region $REGION_B --target-group-arn $TG_ARN_B

# 2. Confirm each regional ALB independently serves traffic.
curl -s -o /dev/null -w "Region A ALB: HTTP %{http_code}\n" http://$ALB_DNS/
curl -s -o /dev/null -w "Region B ALB: HTTP %{http_code}\n" http://$ALB_DNS_B/

# 3. Confirm the Global Accelerator's single anycast IP reaches whichever
#    region is currently closest/healthiest -- this is the actual
#    multi-region proof, not just "two ALBs happen to both work".
curl -s -o /dev/null -w "Global Accelerator ($ACCEL_IP): HTTP %{http_code}\n" http://$ACCEL_IP/

# 4. Confirm the accelerator sees both endpoint groups as healthy.
aws globalaccelerator describe-accelerator-attributes --region us-west-2 --accelerator-arn $ACCEL_ARN
aws globalaccelerator list-endpoint-groups --region us-west-2 --listener-arn $LISTENER_ARN
```

A healthy result: step 1 returns `"State": "healthy"` for both regions' targets; steps 2–3 all return `HTTP 200` (assuming a real HTTP server is actually running on the EC2 instances — this runbook stops at infrastructure and does not install/configure an application server); step 4 lists two endpoint groups, one per region, each associated with a healthy ALB endpoint.

---

## 5. Teardown (safe reverse-dependency order)

Deleting out of order will fail with a dependency error (e.g. AWS refuses to delete a VPC that still has an attached Internet Gateway) — this order is deliberately the exact reverse of Section 3's creation order, so every resource is gone before the resource it depended on is deleted.

```bash
# 1. Global Accelerator (must be disabled before it can be deleted, and
#    disabling takes effect asynchronously).
aws globalaccelerator update-accelerator --region us-west-2 --accelerator-arn $ACCEL_ARN --no-enabled
aws globalaccelerator delete-endpoint-group --region us-west-2 --endpoint-group-arn <endpoint-group-a-arn>
aws globalaccelerator delete-endpoint-group --region us-west-2 --endpoint-group-arn <endpoint-group-b-arn>
aws globalaccelerator delete-listener --region us-west-2 --listener-arn $LISTENER_ARN
# Deletion only succeeds once the accelerator has fully finished disabling --
# poll describe-accelerator until "Enabled": false before this call.
aws globalaccelerator delete-accelerator --region us-west-2 --accelerator-arn $ACCEL_ARN

# 2. For EACH region (repeat with REGION_A/its IDs, then REGION_B/its IDs):

#    2a. ALB, then its listener (listeners are deleted automatically with
#        the ALB, but the ALB itself must be deleted before its target
#        group and before the security group it uses).
aws elbv2 delete-load-balancer --region $REGION_A --load-balancer-arn $ALB_ARN
aws elbv2 wait load-balancers-deleted --region $REGION_A --load-balancer-arns $ALB_ARN

#    2b. Target group (only after the ALB referencing it is gone).
aws elbv2 delete-target-group --region $REGION_A --target-group-arn $TG_ARN

#    2c. EC2 instance (only after it's no longer registered as a target).
aws ec2 terminate-instances --region $REGION_A --instance-ids $INSTANCE_ID
aws ec2 wait instance-terminated --region $REGION_A --instance-ids $INSTANCE_ID

#    2d. Security groups (only after nothing references them -- the ALB
#        and EC2 instance using them must already be gone).
aws ec2 delete-security-group --region $REGION_A --group-id $EC2_SG_ID
aws ec2 delete-security-group --region $REGION_A --group-id $ALB_SG_ID

#    2e. NAT Gateway (only after nothing routes through it), then release
#        its Elastic IP (only after the NAT Gateway is gone).
aws ec2 delete-nat-gateway --region $REGION_A --nat-gateway-id $NAT_GW_ID
aws ec2 wait nat-gateway-deleted --region $REGION_A --nat-gateway-ids $NAT_GW_ID
aws ec2 release-address --region $REGION_A --allocation-id $NAT_EIP_ALLOC_ID

#    2f. Route table associations are removed automatically when a subnet
#        is deleted, but route tables themselves must be deleted before
#        the VPC. Subnets must be deleted before route tables/IGW/VPC.
aws ec2 delete-subnet --region $REGION_A --subnet-id $PUBLIC_SUBNET_ID
aws ec2 delete-subnet --region $REGION_A --subnet-id $PUBLIC_SUBNET_ID_2
aws ec2 delete-subnet --region $REGION_A --subnet-id $PRIVATE_SUBNET_ID
aws ec2 delete-route-table --region $REGION_A --route-table-id $PUBLIC_RT_ID
aws ec2 delete-route-table --region $REGION_A --route-table-id $PRIVATE_RT_ID

#    2g. Internet Gateway must be detached before it (or the VPC) can be
#        deleted.
aws ec2 detach-internet-gateway --region $REGION_A --vpc-id $VPC_ID --internet-gateway-id $IGW_ID
aws ec2 delete-internet-gateway --region $REGION_A --internet-gateway-id $IGW_ID

#    2h. VPC last -- only deletable once every resource inside/attached to
#        it above is gone.
aws ec2 delete-vpc --region $REGION_A --vpc-id $VPC_ID

# 3. Key pair(s), if created solely for this exercise.
aws ec2 delete-key-pair --region $REGION_A --key-name $KEY_NAME
rm -f ${KEY_NAME}-${REGION_A}.pem ${KEY_NAME}-${REGION_B}.pem
```

Repeat step 2 in full for `$REGION_B` (its own `ALB_ARN_B`, `TG_ARN_B`, `INSTANCE_ID_B`, `EC2_SG_ID_B`, `ALB_SG_ID_B`, `NAT_GW_ID_B`, `NAT_EIP_ALLOC_ID_B`, subnet/route-table/IGW/VPC IDs for region B) before considering teardown complete. After both regions and the accelerator are torn down, confirm zero remaining billable resources:

```bash
aws ec2 describe-nat-gateways --region $REGION_A --filter "Name=tag:Name,Values=$PROJECT_TAG-*" --query 'NatGateways[?State!=`deleted`]'
aws ec2 describe-nat-gateways --region $REGION_B --filter "Name=tag:Name,Values=$PROJECT_TAG-*" --query 'NatGateways[?State!=`deleted`]'
aws elbv2 describe-load-balancers --region $REGION_A --query "LoadBalancers[?contains(LoadBalancerName, '$PROJECT_TAG')]"
aws elbv2 describe-load-balancers --region $REGION_B --query "LoadBalancers[?contains(LoadBalancerName, '$PROJECT_TAG')]"
aws globalaccelerator list-accelerators --region us-west-2 --query "Accelerators[?contains(Name, '$PROJECT_TAG')]"
```
All five should return empty lists.

---

## 6. Appendix — the original 5-step architecture's other pieces (explicitly out of scope here)

The user's original 5-step real-AWS architecture described more than the network layer this runbook covers. The following are named for completeness and traceability back to that original request, but are **conceptual bullets only** — no code, no CLI commands, nothing executed or implemented anywhere in this repository:

- **Agent deployment** — four conceptual agent roles (monitoring, policy, optimization, security) that would run against this infrastructure once live. Not built here; see `docs/GCP_INFRASTRUCTURE_SETUP.md §5` for the equivalent GCP-service mapping of these same four roles (Cloud Monitoring/Ops Agent, Cloud Asset Inventory/Org Policy Service, Network Intelligence Center, Security Command Center) — the AWS-side equivalents (CloudWatch/Systems Manager, AWS Config/Organizations SCPs, VPC Reachability Analyzer/Trusted Advisor, Security Hub/GuardDuty) are named here for symmetry but are equally unimplemented.
- **Live simulation flow** — the idea of driving real traffic against this infrastructure the way `planesplit/`'s deterministic simulator drives synthetic flows today. Not built; `planesplit/` and this AWS infrastructure remain two entirely separate, unconnected things by design (see the status banner above).
- **Optimization loop** — an automated feedback loop that would adjust routing/scaling based on observed telemetry. Not built; see `docs/FUTURE_VISION.md` for the closest existing write-up of a recommendation-style layer (explicitly marked not implemented there too).
- **Human control** — an approval/review step gating any automated change before it takes effect. Not built; `docs/FUTURE_VISION.md §4` discusses why a human-review gate is the real trust boundary for any future AI-assisted layer, but no such workflow, UI, or persistence exists anywhere in this codebase today.

None of the four bullets above have any implementation, test, or demo evidence anywhere in this repository — they are recorded here solely so the original request's full scope is traceable, per this project's honesty discipline (`CLAUDE.md` §4, §8, §44).
