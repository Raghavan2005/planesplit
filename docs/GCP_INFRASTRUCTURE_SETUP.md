# GCP Infrastructure Setup — Optional, Documentation-Only Runbook

> ## STATUS BANNER — READ FIRST
> **This document is not connected to the PS31 simulator in any way**, exactly like its AWS counterpart (`docs/AWS_INFRASTRUCTURE_SETUP.md`). `planesplit/`, `backend/`, and `frontend/` remain a deterministic, in-memory, pure-software simulation (`docs/DECISION.md`, `docs/ARCHITECTURE.md §5`). Nothing below is executed, wired in, imported, or referenced by any code in this repository.
>
> **No `gcloud` CLI or GCP credentials exist in this environment.** This runbook was written without ever running a single command against a real GCP project — every command below is unverified against a live account until you run it yourself. The user will supply real GCP credentials separately, later, only if/when actually deploying.
>
> **Running any command in this document costs real money** — Compute Engine instances, the External HTTP(S) Load Balancer's forwarding rules, and cross-region egress all bill continuously regardless of traffic volume.
>
> For the conceptual, not-yet-built AI/agent layer, see `docs/FUTURE_VISION.md` and Section 5 below. For why the project chose pure simulation over real infrastructure, see `docs/DECISION.md` and `docs/ARCHITECTURE.md §5`.
>
> **No Terraform, no Deployment Manager, no Pulumi.** Every step is a raw `gcloud` CLI invocation, run command-by-command by a human.

---

## 1. Prerequisites checklist

- [ ] **A dedicated GCP project** (sandbox, not production) with billing enabled and a budget alert configured (Billing → Budgets & alerts) before creating anything below.
- [ ] **Least-privilege IAM.** Do not use the project owner's personal account for automation. Grant a service account (or your own user, for manual runbook execution) only `roles/compute.networkAdmin`, `roles/compute.instanceAdmin.v1`, and `roles/compute.loadBalancerAdmin` — not `roles/owner` or `roles/editor`.
- [ ] **`gcloud` CLI installed and authenticated** — verify with `gcloud --version` and `gcloud auth list` (confirm the active account is the intended one, not a stale/unexpected login).
- [ ] **Project and default region/zone set**: `gcloud config set project <PROJECT_ID>`, `gcloud config set compute/region <REGION>`, `gcloud config set compute/zone <ZONE>` — or pass `--project`/`--region`/`--zone` explicitly on every command, which this runbook does throughout so no command silently depends on unset config state.
- [ ] **Two target regions chosen** for the multi-region section (this runbook uses `us-central1` and `europe-west1` as examples).
- [ ] **Cost warning acknowledged**: an External HTTP(S) Load Balancer's forwarding rule and each Compute Engine instance bill continuously from creation, not just under load; a Cloud NAT gateway (used here so instances in a private subnet get outbound internet access without a public IP) also bills per-hour plus per-GB processed.
- [ ] **APIs enabled** on the project before Section 3 will work: `gcloud services enable compute.googleapis.com`.

---

## 2. Naming and variable conventions used below

```bash
export PROJECT_ID=ps31-infra-demo
export REGION_A=us-central1
export REGION_B=europe-west1
export ZONE_A=us-central1-a
export ZONE_B=europe-west1-b
export NET_TAG=ps31-net
```

---

## 3. Step-by-step setup

### 3.1 VPC network (custom-mode, spans both regions by design — GCP VPC networks are global resources, unlike an AWS VPC which is region-scoped)

```bash
gcloud compute networks create $NET_TAG \
  --project=$PROJECT_ID \
  --subnet-mode=custom \
  --bgp-routing-mode=regional
```

### 3.2 Subnets (one per region — subnets are regional even though the network above is global)

```bash
gcloud compute networks subnets create $NET_TAG-subnet-a \
  --project=$PROJECT_ID --network=$NET_TAG --region=$REGION_A \
  --range=10.0.1.0/24

gcloud compute networks subnets create $NET_TAG-subnet-b \
  --project=$PROJECT_ID --network=$NET_TAG --region=$REGION_B \
  --range=10.1.1.0/24
```

### 3.3 Cloud Router + Cloud NAT (per region — GCP's equivalent of an AWS NAT Gateway, giving private/no-external-IP instances outbound internet access)

```bash
for R in $REGION_A $REGION_B; do
  gcloud compute routers create $NET_TAG-router-$R \
    --project=$PROJECT_ID --network=$NET_TAG --region=$R

  gcloud compute routers nats create $NET_TAG-nat-$R \
    --project=$PROJECT_ID --router=$NET_TAG-router-$R --region=$R \
    --auto-allocate-nat-external-ips \
    --nat-all-subnet-ip-ranges
done
```

### 3.4 Firewall rules

GCP firewall rules are attached to the network (not a per-instance security group the way AWS security groups are) and apply via network tags:

```bash
# Allow the load balancer's health-check and traffic ranges to reach
# instances tagged "ps31-web" on port 80. 130.211.0.0/22 and 35.191.0.0/16
# are Google's documented, fixed health-check/LB source ranges.
gcloud compute firewall-rules create $NET_TAG-allow-lb-and-health \
  --project=$PROJECT_ID --network=$NET_TAG --direction=INGRESS \
  --action=ALLOW --rules=tcp:80 \
  --source-ranges=130.211.0.0/22,35.191.0.0/16 \
  --target-tags=ps31-web

# Admin SSH -- replace with your real admin CIDR, never 0.0.0.0/0.
gcloud compute firewall-rules create $NET_TAG-allow-ssh-admin \
  --project=$PROJECT_ID --network=$NET_TAG --direction=INGRESS \
  --action=ALLOW --rules=tcp:22 \
  --source-ranges=203.0.113.0/32 \
  --target-tags=ps31-web
```

### 3.5 Compute Engine instance(s) — one per region

```bash
gcloud compute instances create $NET_TAG-app-a \
  --project=$PROJECT_ID --zone=$ZONE_A \
  --machine-type=e2-micro \
  --network=$NET_TAG --subnet=$NET_TAG-subnet-a \
  --no-address \
  --tags=ps31-web \
  --image-family=debian-12 --image-project=debian-cloud

gcloud compute instances create $NET_TAG-app-b \
  --project=$PROJECT_ID --zone=$ZONE_B \
  --machine-type=e2-micro \
  --network=$NET_TAG --subnet=$NET_TAG-subnet-b \
  --no-address \
  --tags=ps31-web \
  --image-family=debian-12 --image-project=debian-cloud
```

### 3.6 Unmanaged instance groups (one per zone, backing the two instances above)

```bash
gcloud compute instance-groups unmanaged create $NET_TAG-ig-a \
  --project=$PROJECT_ID --zone=$ZONE_A
gcloud compute instance-groups unmanaged add-instances $NET_TAG-ig-a \
  --project=$PROJECT_ID --zone=$ZONE_A --instances=$NET_TAG-app-a
gcloud compute instance-groups unmanaged set-named-ports $NET_TAG-ig-a \
  --project=$PROJECT_ID --zone=$ZONE_A --named-ports=http:80

gcloud compute instance-groups unmanaged create $NET_TAG-ig-b \
  --project=$PROJECT_ID --zone=$ZONE_B
gcloud compute instance-groups unmanaged add-instances $NET_TAG-ig-b \
  --project=$PROJECT_ID --zone=$ZONE_B --instances=$NET_TAG-app-b
gcloud compute instance-groups unmanaged set-named-ports $NET_TAG-ig-b \
  --project=$PROJECT_ID --zone=$ZONE_B --named-ports=http:80
```

### 3.7 Health check + backend service

```bash
gcloud compute health-checks create http $NET_TAG-hc \
  --project=$PROJECT_ID --port=80 --request-path=/

gcloud compute backend-services create $NET_TAG-backend \
  --project=$PROJECT_ID --global \
  --protocol=HTTP --port-name=http \
  --health-checks=$NET_TAG-hc \
  --load-balancing-scheme=EXTERNAL_MANAGED

gcloud compute backend-services add-backend $NET_TAG-backend \
  --project=$PROJECT_ID --global \
  --instance-group=$NET_TAG-ig-a --instance-group-zone=$ZONE_A \
  --balancing-mode=UTILIZATION --max-utilization=0.8

gcloud compute backend-services add-backend $NET_TAG-backend \
  --project=$PROJECT_ID --global \
  --instance-group=$NET_TAG-ig-b --instance-group-zone=$ZONE_B \
  --balancing-mode=UTILIZATION --max-utilization=0.8
```

### 3.8 External HTTP(S) Load Balancer — URL map, target proxy, forwarding rule

```bash
gcloud compute url-maps create $NET_TAG-urlmap \
  --project=$PROJECT_ID --default-service=$NET_TAG-backend

gcloud compute target-http-proxies create $NET_TAG-http-proxy \
  --project=$PROJECT_ID --url-map=$NET_TAG-urlmap

# A single global forwarding rule is what actually gives this its one
# anycast IP -- see the note in Section 3.9 below.
gcloud compute forwarding-rules create $NET_TAG-fwd-rule \
  --project=$PROJECT_ID --global \
  --target-http-proxy=$NET_TAG-http-proxy \
  --ports=80

LB_IP=$(gcloud compute forwarding-rules describe $NET_TAG-fwd-rule \
  --project=$PROJECT_ID --global --format='value(IPAddress)')
echo "Global External Application Load Balancer IP: $LB_IP"
```

### 3.9 Why there is no separate "Global Accelerator" step here — a genuine architecture difference from AWS

`docs/AWS_INFRASTRUCTURE_SETUP.md` needs an explicit, separate Global Accelerator resource (Section 3.12 of that doc) layered on top of two independent regional ALBs, because an AWS Application Load Balancer is inherently regional — reaching two regions under one static anycast IP requires a distinct product (Global Accelerator) in front of them. GCP's **External Application Load Balancer used in Global mode is already anycast by construction**: the single global forwarding rule created in Section 3.8 above, backed by one global backend service pointing at instance groups in *both* `$ZONE_A` and `$ZONE_B`, already gives one static IP (`$LB_IP`) that Google's edge network routes to whichever backend is closest/healthiest — no second resource, no second product, no second IP to manage. This is the one deliberate structural difference this runbook calls out explicitly, per the task requirement to note it: **AWS needs a load balancer plus a separate accelerator; GCP's global load balancer already is the accelerator.**

---

## 4. Verification commands

```bash
# 1. Confirm both backends are healthy.
gcloud compute backend-services get-health $NET_TAG-backend --project=$PROJECT_ID --global

# 2. Confirm the single global anycast IP actually serves traffic (assuming
#    a real HTTP server is running on the instances -- this runbook stops
#    at infrastructure, same scope boundary as the AWS doc).
curl -s -o /dev/null -w "Global LB ($LB_IP): HTTP %{http_code}\n" http://$LB_IP/

# 3. Confirm the firewall rules are actually attached and scoped as intended.
gcloud compute firewall-rules list --project=$PROJECT_ID --filter="network:$NET_TAG"

# 4. Confirm Cloud NAT is actually providing egress (no external IP was
#    assigned to either instance in 3.5 -- this is the only way they reach
#    the internet at all, e.g. for OS package updates).
gcloud compute routers nats describe $NET_TAG-nat-$REGION_A \
  --project=$PROJECT_ID --router=$NET_TAG-router-$REGION_A --region=$REGION_A
```

A healthy result: step 1 reports `"healthState": "HEALTHY"` for both backends; step 2 returns `HTTP 200`; step 3 lists both firewall rules with the expected source ranges/tags; step 4 shows the NAT active with auto-allocated external IPs.

---

## 5. Agent layer — explicitly NOT IMPLEMENTED

Mirroring `docs/AWS_INFRASTRUCTURE_SETUP.md`'s appendix and the same honesty discipline this project applies everywhere else (`CLAUDE.md` §4, §8, §44): the four agent roles from the original request are named here conceptually, mapped to the real GCP service each would be built on, with **zero code, zero configuration, and zero execution** behind any of them.

| Agent role | GCP service it would be built on | Notes |
|---|---|---|
| **Monitoring agent** | Cloud Monitoring + Ops Agent | Ops Agent installed on each Compute Engine instance would ship CPU/memory/disk/network metrics and logs to Cloud Monitoring/Cloud Logging; a monitoring agent role would consume that telemetry, not reimplement metric collection. |
| **Policy agent** | Cloud Asset Inventory + Org Policy Service | Cloud Asset Inventory would give a point-in-time and historical view of every resource's actual configuration; Org Policy Service would enforce guardrails (e.g. disallow public IPs, restrict allowed machine types). This is GCP's structural equivalent of the AWS Route Tables/VPC Flow Logs "intended vs. observed" pairing `docs/FUTURE_VISION.md §3` maps out — on GCP the closer analogue is **VPC firewall rules/routes (intent) vs. VPC Flow Logs (observed reality)**, the same RIB/FIB-shaped pattern this project's core simulator already proves out, just against a different cloud's naming. |
| **Optimization agent** | Network Intelligence Center | Its Performance Dashboard, Topology, and Connectivity Tests sub-products would be the source of real path/latency/reachability data an optimization agent would reason over — again, evidence-gathering only; no automated change-application exists or is proposed here. |
| **Security agent** | Security Command Center | Would surface real misconfiguration/vulnerability findings (e.g. an overly-broad firewall rule, a publicly-exposed instance) for a security agent to consume; SCC's own detections are the evidence source, not something this runbook reimplements. |

None of the four rows above have any implementation, test, or demo evidence anywhere in this repository. As with the AWS appendix, this table exists solely so the original request's full four-agent scope is traceable against what was actually asked for, without ever being confused with what is actually built (`docs/INNOVATION.md` is the only document that gets to claim "built and tested").

---

## 6. Teardown (safe reverse-dependency order)

```bash
# 1. Global forwarding rule, then target proxy, then URL map -- each only
#    deletable once nothing downstream of it still references it.
gcloud compute forwarding-rules delete $NET_TAG-fwd-rule --project=$PROJECT_ID --global --quiet
gcloud compute target-http-proxies delete $NET_TAG-http-proxy --project=$PROJECT_ID --quiet
gcloud compute url-maps delete $NET_TAG-urlmap --project=$PROJECT_ID --quiet

# 2. Backend service (only after the URL map that referenced it is gone),
#    then the health check it used.
gcloud compute backend-services delete $NET_TAG-backend --project=$PROJECT_ID --global --quiet
gcloud compute health-checks delete $NET_TAG-hc --project=$PROJECT_ID --quiet

# 3. Instance groups (only after the backend service referencing them is
#    gone).
gcloud compute instance-groups unmanaged delete $NET_TAG-ig-a --project=$PROJECT_ID --zone=$ZONE_A --quiet
gcloud compute instance-groups unmanaged delete $NET_TAG-ig-b --project=$PROJECT_ID --zone=$ZONE_B --quiet

# 4. Compute Engine instances (only after they're no longer group members).
gcloud compute instances delete $NET_TAG-app-a --project=$PROJECT_ID --zone=$ZONE_A --quiet
gcloud compute instances delete $NET_TAG-app-b --project=$PROJECT_ID --zone=$ZONE_B --quiet

# 5. Firewall rules (only after nothing tagged ps31-web still exists to need them).
gcloud compute firewall-rules delete $NET_TAG-allow-lb-and-health --project=$PROJECT_ID --quiet
gcloud compute firewall-rules delete $NET_TAG-allow-ssh-admin --project=$PROJECT_ID --quiet

# 6. Cloud NAT, then the Cloud Router it depended on -- per region.
for R in $REGION_A $REGION_B; do
  gcloud compute routers nats delete $NET_TAG-nat-$R --project=$PROJECT_ID --router=$NET_TAG-router-$R --region=$R --quiet
  gcloud compute routers delete $NET_TAG-router-$R --project=$PROJECT_ID --region=$R --quiet
done

# 7. Subnets (only after every instance/NAT using them is gone).
gcloud compute networks subnets delete $NET_TAG-subnet-a --project=$PROJECT_ID --region=$REGION_A --quiet
gcloud compute networks subnets delete $NET_TAG-subnet-b --project=$PROJECT_ID --region=$REGION_B --quiet

# 8. VPC network last -- only deletable once every subnet/firewall rule
#    attached to it is gone.
gcloud compute networks delete $NET_TAG --project=$PROJECT_ID --quiet
```

Confirm zero remaining billable resources:

```bash
gcloud compute instances list --project=$PROJECT_ID --filter="name~$NET_TAG"
gcloud compute forwarding-rules list --project=$PROJECT_ID --filter="name~$NET_TAG"
gcloud compute routers nats list --project=$PROJECT_ID --router=$NET_TAG-router-$REGION_A --region=$REGION_A 2>/dev/null
gcloud compute networks list --project=$PROJECT_ID --filter="name~$NET_TAG"
```
All four should return empty (the NAT list command is expected to error once its parent router is already deleted — that error itself confirms nothing is left).

---

## 7. Explicitly out of scope

No command execution against a real GCP project as part of writing this document. No agent code (Section 5 is conceptual only). No changes to `planesplit/`, `backend/`, or `frontend/`. No AWS-vs-GCP decision is being forced by writing both runbooks — they exist side by side as two independent, equally-optional, equally-unexecuted references.
