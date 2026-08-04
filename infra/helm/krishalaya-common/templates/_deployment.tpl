{{- define "krishalaya-common.deployment" -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "krishalaya-common.fullname" . }}
  labels:
    {{- include "krishalaya-common.labels" . | nindent 4 }}
spec:
  revisionHistoryLimit: {{ .Values.revisionHistoryLimit }}
  {{- if not .Values.autoscaling.enabled }}
  replicas: {{ .Values.replicaCount }}
  {{- end }}
  selector:
    matchLabels:
      {{- include "krishalaya-common.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "krishalaya-common.labels" . | nindent 8 }}
    spec:
      serviceAccountName: {{ include "krishalaya-common.serviceAccountName" . }}
      securityContext:
        {{- toYaml .Values.podSecurityContext | nindent 8 }}
      {{- with .Values.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.tolerations }}
      tolerations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.affinity }}
      affinity:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- if .Values.topologySpreadConstraints }}
      topologySpreadConstraints:
        {{- range .Values.topologySpreadConstraints }}
        - maxSkew: {{ .maxSkew }}
          topologyKey: {{ .topologyKey }}
          whenUnsatisfiable: {{ .whenUnsatisfiable }}
          labelSelector:
            matchLabels:
              {{- include "krishalaya-common.selectorLabels" $ | nindent 14 }}
        {{- end }}
      {{- end }}
      containers:
        - name: {{ include "krishalaya-common.name" . }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          securityContext:
            {{- toYaml .Values.securityContext | nindent 12 }}
          {{- with .Values.command }}
          command: {{ toYaml . | nindent 12 }}
          {{- end }}
          {{- with .Values.args }}
          args: {{ toYaml . | nindent 12 }}
          {{- end }}
          {{- if .Values.service.enabled }}
          ports:
            - name: {{ if .Values.service.grpc }}grpc{{ else }}http{{ end }}
              containerPort: {{ .Values.service.targetPort }}
              protocol: TCP
          {{- end }}
          {{- if .Values.env }}
          env:
            {{- range .Values.env }}
            - name: {{ .name }}
              value: {{ .value | quote }}
            {{- end }}
            {{- range .Values.secretEnv }}
            - name: {{ .name }}
              valueFrom:
                secretKeyRef:
                  name: {{ .secretName }}
                  key: {{ .secretKey }}
            {{- end }}
          {{- end }}
          {{- if .Values.envFromSecretNames }}
          envFrom:
            {{- range .Values.envFromSecretNames }}
            - secretRef:
                name: {{ . }}
            {{- end }}
          {{- end }}
          {{- if ne .Values.livenessProbe.type "none" }}
          livenessProbe:
            {{- include "krishalaya-common.probe" (dict "p" .Values.livenessProbe "Values" .Values) | nindent 12 }}
          {{- end }}
          {{- if ne .Values.readinessProbe.type "none" }}
          readinessProbe:
            {{- include "krishalaya-common.probe" (dict "p" .Values.readinessProbe "Values" .Values) | nindent 12 }}
          {{- end }}
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
          volumeMounts:
            - name: tmp
              mountPath: /tmp
            {{- with .Values.extraVolumeMounts }}
            {{- toYaml . | nindent 12 }}
            {{- end }}
      volumes:
        - name: tmp
          emptyDir: {}
        {{- with .Values.extraVolumes }}
        {{- toYaml . | nindent 8 }}
        {{- end }}
{{- end -}}

{{/* probe renderer: http | tcp | exec */}}
{{- define "krishalaya-common.probe" -}}
{{- $p := .p -}}
{{- if eq $p.type "http" }}
httpGet:
  path: {{ $p.path }}
  port: {{ .Values.service.targetPort }}
{{- else if eq $p.type "tcp" }}
tcpSocket:
  port: {{ .Values.service.targetPort }}
{{- else if eq $p.type "exec" }}
exec:
  command:
    {{- toYaml $p.command | nindent 4 }}
{{- end }}
initialDelaySeconds: {{ $p.initialDelaySeconds }}
periodSeconds: {{ $p.periodSeconds }}
timeoutSeconds: {{ $p.timeoutSeconds }}
failureThreshold: {{ $p.failureThreshold }}
{{- end -}}
