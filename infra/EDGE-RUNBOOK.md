# Edge runbook — public HTTPS for krishalaya.com (ALB + WAF + ACM + Route 53)

Final P0-1 wave: expose the in-cluster services to the internet on `krishalaya.com` over HTTPS, behind WAF.
Prereqs: the foundation (`APPLY-RUNBOOK-prod.md`) and the services (`DEPLOY-RUNBOOK.md`) are already up.

Architecture: one shared **ALB** (created by the AWS Load Balancer Controller from the Ingress group
`krishalaya-edge`) → WAF attached → wildcard ACM cert for TLS → **external-dns** writes the Route 53 records
automatically from each Ingress host.

Hostnames:
```
krishalaya.com, www.krishalaya.com  -> web-storefront
api.krishalaya.com                   -> api
admin.krishalaya.com                 -> web-admin
admin-api.krishalaya.com             -> admin-api
partner.krishalaya.com               -> web-partner
tenant.krishalaya.com                -> web-tenant
rt.krishalaya.com                    -> realtime-gateway (sticky)
```
(wallet-service, worker, ai-services stay internal — no Ingress.)

---

## 1. Apply the edge Terraform

```bash
cd infra/terraform/envs/prod
terraform plan -out tf.plan && terraform apply tf.plan
```
This creates the Route 53 zone, the wildcard ACM cert (DNS-validated automatically in that zone), the WAF web ACL,
and the IAM roles for the controller + external-dns. Grab the outputs:
```bash
terraform output route53_name_servers     # -> delegate at your registrar (step 2)
terraform output -raw acm_certificate_arn  # -> CERT_ARN below
terraform output -raw waf_web_acl_arn       # -> WAF_ARN below
terraform output -raw alb_controller_role_arn
terraform output -raw external_dns_role_arn
```

> **Cert validation waits on DNS.** Because the validation records are created in the *new* Route 53 zone, ACM can
> only validate once your registrar delegates to that zone (step 2). If `apply` blocks on
> `aws_acm_certificate_validation`, complete step 2 first, then re-run apply.

---

## 2. Delegate the domain to Route 53 (one time, at your registrar)

At wherever you bought `krishalaya.com`, set the domain's **nameservers** to the 4 from
`terraform output route53_name_servers`. Propagation is usually minutes, up to 48h. Verify:
```bash
dig +short NS krishalaya.com      # should list the AWS ns-xxxx servers
```

---

## 3. Install the AWS Load Balancer Controller (creates ALBs from Ingress)

```bash
CLUSTER=$(terraform output -raw eks_cluster_name)
VPC_ID=$(aws eks describe-cluster --name $CLUSTER --query 'cluster.resourcesVpcConfig.vpcId' --output text)
LBC_ROLE=$(terraform output -raw alb_controller_role_arn)

kubectl -n kube-system create serviceaccount aws-load-balancer-controller \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n kube-system annotate serviceaccount aws-load-balancer-controller \
  eks.amazonaws.com/role-arn=$LBC_ROLE --overwrite

helm repo add eks https://aws.github.io/eks-charts && helm repo update
helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=$CLUSTER \
  --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller \
  --set region=ap-south-1 \
  --set vpcId=$VPC_ID
kubectl -n kube-system rollout status deploy/aws-load-balancer-controller
```

---

## 4. Install external-dns (writes Route 53 records from Ingress hosts)

```bash
EDNS_ROLE=$(terraform output -raw external_dns_role_arn)
ZONE_ID=$(terraform output -raw route53_zone_id)

helm repo add external-dns https://kubernetes-sigs.github.io/external-dns/ && helm repo update
helm upgrade --install external-dns external-dns/external-dns -n external-dns --create-namespace \
  --set provider=aws \
  --set policy=upsert-only \
  --set txtOwnerId=krishalaya-prod \
  --set domainFilters[0]=krishalaya.com \
  --set "extraArgs[0]=--zone-id-filter=$ZONE_ID" \
  --set serviceAccount.name=external-dns \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=$EDNS_ROLE
kubectl -n external-dns rollout status deploy/external-dns
```

---

## 5. (Re)install the app charts with cert + WAF + ingress enabled

The charts already declare the Ingresses; pass the cert + WAF ARNs (and host overrides for the web releases):
```bash
ECR=$(aws sts get-caller-identity --query Account --output text).dkr.ecr.ap-south-1.amazonaws.com
TAG=$(git rev-parse --short HEAD)
CERT_ARN=$(terraform -chdir=infra/terraform/envs/prod output -raw acm_certificate_arn)
WAF_ARN=$(terraform -chdir=infra/terraform/envs/prod output -raw waf_web_acl_arn)
cd infra/helm

common() { echo --set ingress.certArn=$CERT_ARN --set ingress.wafArn=$WAF_ARN; }

helm upgrade --install api ./api -n krishalaya --set image.repository=$ECR/krishalaya-api --set image.tag=$TAG $(common)
helm upgrade --install admin-api ./admin-api -n krishalaya --set image.repository=$ECR/krishalaya-admin-api --set image.tag=$TAG $(common)
helm upgrade --install realtime-gateway ./realtime-gateway -n krishalaya --set image.repository=$ECR/krishalaya-realtime-gateway --set image.tag=$TAG $(common)

# web releases — same generic chart, override image + ingress host(s):
helm upgrade --install web-storefront ./web -n krishalaya --set image.repository=$ECR/krishalaya-web-storefront --set image.tag=$TAG $(common)
helm upgrade --install web-tenant ./web -n krishalaya --set image.repository=$ECR/krishalaya-web-tenant --set image.tag=$TAG \
  --set ingress.hosts[0]=tenant.krishalaya.com --set ingress.healthcheckPath=/ $(common)
helm upgrade --install web-admin ./web -n krishalaya --set image.repository=$ECR/krishalaya-web-admin --set image.tag=$TAG \
  --set ingress.hosts[0]=admin.krishalaya.com --set ingress.healthcheckPath=/ $(common)
helm upgrade --install web-partner ./web-partner -n krishalaya --set image.repository=$ECR/krishalaya-web-partner --set image.tag=$TAG $(common)
```

> All Ingresses share `group.name=krishalaya-edge`, so the controller provisions **one ALB** for everything (cheap).
> external-dns then creates the A/ALIAS records for each host pointing at that ALB.

---

## 6. Verify public HTTPS

```bash
kubectl -n krishalaya get ingress          # ADDRESS column = the shared ALB DNS name
dig +short api.krishalaya.com               # resolves to the ALB (external-dns)
curl -sS https://api.krishalaya.com/healthz # 200 over TLS via WAF -> ALB -> api pod
curl -sSI https://krishalaya.com            # storefront 200; http:// should 301 -> https
```
TLS valid, `/healthz` green, http→https redirect working = **P0-1 is fully closed.** 🎉

---

## Troubleshooting
- **Ingress has no ADDRESS:** controller can't see the subnets. Confirm public subnets are tagged
  `kubernetes.io/role/elb=1` (the VPC module sets this) and the controller pod logs are clean.
- **DNS doesn't resolve:** registrar delegation (step 2) not done/propagated, or external-dns lacks the zone role —
  check `kubectl -n external-dns logs deploy/external-dns`.
- **Cert stuck PENDING_VALIDATION:** the zone isn't authoritative yet (step 2). ACM validates after delegation.
- **502/504 from ALB:** target group health failing — check the chart's `ingress.healthcheckPath` matches a 200
  route (`/healthz` for services, `/` for the Next web apps) and pods are Ready.
