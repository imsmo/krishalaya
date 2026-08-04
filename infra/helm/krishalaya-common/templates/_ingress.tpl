{{- define "krishalaya-common.ingress" -}}
{{- if .Values.ingress.enabled -}}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "krishalaya-common.fullname" . }}
  labels:
    {{- include "krishalaya-common.labels" . | nindent 4 }}
  annotations:
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/group.name: {{ .Values.ingress.groupName }}
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTP":80},{"HTTPS":443}]'
    alb.ingress.kubernetes.io/ssl-redirect: '443'
    alb.ingress.kubernetes.io/backend-protocol: HTTP
    alb.ingress.kubernetes.io/healthcheck-path: {{ .Values.ingress.healthcheckPath | quote }}
    alb.ingress.kubernetes.io/healthcheck-port: traffic-port
    {{- if .Values.ingress.certArn }}
    alb.ingress.kubernetes.io/certificate-arn: {{ .Values.ingress.certArn | quote }}
    {{- end }}
    {{- if .Values.ingress.wafArn }}
    alb.ingress.kubernetes.io/wafv2-acl-arn: {{ .Values.ingress.wafArn | quote }}
    {{- end }}
    {{- range $k, $v := .Values.ingress.annotations }}
    {{ $k }}: {{ $v | quote }}
    {{- end }}
spec:
  ingressClassName: {{ .Values.ingress.className }}
  rules:
    {{- range .Values.ingress.hosts }}
    - host: {{ . | quote }}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {{ include "krishalaya-common.fullname" $ }}
                port:
                  number: {{ $.Values.service.port }}
    {{- end }}
{{- end -}}
{{- end -}}
