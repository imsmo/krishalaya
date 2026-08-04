{{- define "krishalaya-common.pdb" -}}
{{- if .Values.pdb.enabled -}}
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ include "krishalaya-common.fullname" . }}
  labels:
    {{- include "krishalaya-common.labels" . | nindent 4 }}
spec:
  minAvailable: {{ .Values.pdb.minAvailable }}
  selector:
    matchLabels:
      {{- include "krishalaya-common.selectorLabels" . | nindent 6 }}
{{- end -}}
{{- end -}}
