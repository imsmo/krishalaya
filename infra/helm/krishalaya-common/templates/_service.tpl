{{- define "krishalaya-common.service" -}}
{{- if .Values.service.enabled -}}
apiVersion: v1
kind: Service
metadata:
  name: {{ include "krishalaya-common.fullname" . }}
  labels:
    {{- include "krishalaya-common.labels" . | nindent 4 }}
spec:
  type: {{ .Values.service.type }}
  {{- if .Values.service.sessionAffinity }}
  sessionAffinity: {{ .Values.service.sessionAffinity }}
  {{- end }}
  selector:
    {{- include "krishalaya-common.selectorLabels" . | nindent 4 }}
  ports:
    - name: {{ if .Values.service.grpc }}grpc{{ else }}http{{ end }}
      port: {{ .Values.service.port }}
      targetPort: {{ .Values.service.targetPort }}
      protocol: TCP
      {{- if .Values.service.grpc }}
      appProtocol: grpc
      {{- end }}
{{- end -}}
{{- end -}}
