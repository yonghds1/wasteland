# CLI Debug Output Conventions Research

## Summary

Research on how mainstream CLI tools handle structured debug/trace output.

**Date**: 2026-05-23

---

## Tools Researched

- AWS CLI
- kubectl (Kubernetes CLI)
- Docker CLI
- GitHub CLI (gh)
- Terraform CLI
- General patterns

---

## 1. AWS CLI

### Command Output Format

```bash
aws ec2 describe-instances --output json    # stdout
aws ec2 describe-instances --output yaml    # stdout
aws ec2 describe-instances --output text    # stdout
aws ec2 describe-instances --output table   # stdout
```

- `--output` / `-o` option: `json`, `yaml`, `text`, `table`
- Output goes to **stdout**

### Debug Output

```bash
aws ec2 describe-instances --debug
```

- `--debug` flag enables verbose logging
- Debug output goes to **stderr**
- Format: **text-based** (human-readable), not JSON structured
- Contains HTTP request/response details, botocore logs, timestamps

### Environment Variables

```bash
AWS_DEBUG=true
AWS_CONFIG_FILE=/dev/null  # debug mode
```

### Key Finding

- **No `--output-format json/jsonl` for debug logs**
- Debug and command output are separate concerns
- Debug is always text format to stderr

---

## 2. kubectl (Kubernetes CLI)

### Command Output Format

```bash
kubectl get pods -o json           # stdout
kubectl get pods -o yaml            # stdout
kubectl get pods -o wide            # stdout (table extended)
kubectl get pods -o jsonpath='{.items[0].metadata.name}'  # stdout
kubectl get pods -o name            # stdout
```

- `-o` / `--output` option: `json`, `yaml`, `wide`, `name`, `jsonpath`, `go-template`, etc.
- Output goes to **stdout**

### Debug/Verbose Output

```bash
kubectl get pods -v=0    # minimal info
kubectl get pods -v=4    # debug level
kubectl get pods -v=6    # detailed HTTP request/response
kubectl get pods -v=8    # raw HTTP request/response
kubectl get pods -v=10   # maximum verbosity
```

- `--v` / `-v` option for log levels (0-10)
- Debug logs go to **stderr**
- Format: **text-based**, not JSON structured
- Uses `klog` logging framework internally

### Additional Options

```bash
--log-flush-frequency=5s    # log buffer flush frequency
--log-dir=/var/log          # optional log directory
--logtostderr=true          # logs to stderr (default)
--alsologtostderr           # log to both file and stderr
```

### Key Finding

- **No structured JSON debug output option**
- Supports `--log-dir` for file output
- `--alsologtostderr` supports simultaneous stderr + file output

---

## 3. Docker CLI

### Command Output Format

```bash
docker ps --format json           # stdout (Docker 25+)
docker inspect --format json      # stdout
docker images --format json       # stdout
```

- `--format json` (Docker 25+) outputs JSON to stdout
- `--format` uses Go template syntax

### Debug Output

```bash
docker --debug
docker --log-level debug
docker --log-level info
docker --log-level warn
docker --log-level error
docker --log-level fatal
```

- `-D` / `--debug` flag enables debug mode
- `--log-level` option for verbosity
- Debug logs go to **stderr**
- Format: **text-based**, not JSON

### Environment Variables

```bash
DOCKER_BUILDKIT=1    # affects build output format
DOCKER_CLI_HINTS     # enable/disable hints
```

### Key Finding

- **No JSON debug output option**
- Command output can be JSON, but debug logs are text
- No native stderr + file output mode

---

## 4. GitHub CLI (gh)

### Command Output Format

```bash
gh issue list --json number,title,state    # stdout JSON output
gh pr list --json number,title,author      # stdout JSON output
gh repo list --yaml                        # stdout YAML output
```

- `--json fields` for structured JSON output to stdout
- `--yaml` for YAML output
- Uses `jq` for further processing

### Debug Output

```bash
GH_DEBUG=true
GH_DEBUG=1
```

- Environment variable `GH_DEBUG=true` enables debug logging
- Debug goes to **stderr**
- Format: text-based HTTP request/response logs

### Key Finding

- **JSON output for commands only, not debug logs**
- Debug via environment variable, not flag
- Debug logs are text format

---

## 5. Terraform CLI

### Command Output Format

```bash
terraform output -json           # stdout JSON
terraform show -json              # stdout JSON
terraform plan -out=tfplan        # binary plan file
```

- `-json` flag for JSON output to stdout
- Binary plan files for complex state

### Debug Output

```bash
TF_LOG=TRACE
TF_LOG=DEBUG
TF_LOG=INFO
TF_LOG=WARN
TF_LOG=ERROR
```

- `TF_LOG` environment variable for log levels
- `TF_LOG_PATH=/tmp/terraform.log` for file output
- Debug logs go to **stderr** by default
- **Can output to both stderr and file simultaneously** with `TF_LOG_PATH`

### JSON Logging

```bash
TF_LOG_JSON=true    # outputs logs in JSON format
```

- **Rare**: Terraform supports JSON-formatted debug logs
- `TF_LOG_JSON=true` enables JSON logging
- JSON format includes: `@level`, `@message`, `@module`, `@timestamp`

### Key Finding

- **JSON debug output available** via `TF_LOG_JSON=true`
- Supports simultaneous stderr + file output
- Most comprehensive debug output options among researched tools

---

## 6. General Patterns Summary

| Tool | Command Output Format | Debug Output Location | Debug Format | Simultaneous Output |
|------|----------------------|----------------------|--------------|---------------------|
| AWS CLI | `--output json/yaml/text/table` | stderr | text | No |
| kubectl | `-o json/yaml/wide/jsonpath` | stderr | text | Yes (`--alsologtostderr`) |
| Docker CLI | `--format json` (Docker 25+) | stderr | text | No |
| GitHub CLI | `--json fields` / `--yaml` | stderr | text | No |
| Terraform | `-json` flag | stderr/file | text/JSON (`TF_LOG_JSON`) | Yes |

---

## Key Findings for rxc CLI Design

### 1. Output Format Options

**Standard Pattern**: CLI tools separate "command output format" from "debug output format"

- Command output (`--output`, `-o`, `--format`): Goes to **stdout**, supports JSON/YAML
- Debug output (`--debug`, `--verbose`, `-v`): Goes to **stderr**, usually text format

### 2. Debug to Stderr

**Universal Convention**: Debug/trace logs go to **stderr**, never stdout

- Ensures debug info doesn't pollute command output
- Allows piping command output to other tools
- Examples: `rxc chat --debug > output.txt 2>/dev/null` (debug discarded)

### 3. Structured Debug Output

**Rare but Valuable**: Only Terraform offers JSON-formatted debug logs

- Terraform: `TF_LOG_JSON=true` enables JSON logs
- Most tools use human-readable text for debug

### 4. Simultaneous Output

**Supported by kubectl and Terraform**:

- kubectl: `--alsologtostderr` (file + stderr)
- Terraform: `TF_LOG_PATH=/path/to/file` + stderr

### 5. JSONL vs JSON

**JSONL preferred for streaming logs**:

- JSONL (JSON Lines): Each line is a valid JSON object
- Better for streaming/real-time log processing
- Can be piped to `jq -c` or other tools
- Common in modern observability tools (Datadog, Splunk, etc.)

---

## Recommendations for rxc

Based on research:

### Current Design (from PRD)

```typescript
// DebugTraceEvent type already defined
type DebugTraceEvent = {
  timestamp: string;
  sessionId: string;
  turn?: number;
  step?: number;
  scope: DebugTraceScope;
  phase: string;
  message: string;
  data?: Record<string, unknown>;
};
```

### Proposed CLI Options

```bash
# Default: debug to stderr in pretty format
rxc chat --debug

# JSONL format to stderr
rxc chat --debug --debug-format jsonl

# Pretty format (explicit)
rxc chat --debug --debug-format pretty
```

### Why This Approach

1. **Separation of concerns**: `--debug-format` only affects debug output, not command output
2. **JSONL for streaming**: Perfect match for `DebugTraceEvent` streaming
3. **Tool-friendly**: JSONL can be piped to `jq`, `grep`, etc.
4. **Backward compatible**: Default is "pretty" for human readability
5. **Conventional**: Debug to stderr follows universal pattern

### Future Considerations

Per PRD "Out of Scope":

- Trace file persistence (`.rxc/traces/<sessionId>.jsonl`)
- Simultaneous stderr + file output

If needed later, consider:

```bash
# Potential future options
rxc chat --debug --debug-file traces/session.jsonl     # file only
rxc chat --debug --debug-file traces/session.jsonl --debug-tee  # both
```

---

## References

### AWS CLI Documentation

- Output formats: https://docs.aws.amazon.com/cli/latest/userguide/cli-usage-output-format.html
- Debug mode: https://docs.aws.amazon.com/cli/latest/userguide/cli-usage-help.html#debug-command

### kubectl Documentation

- Output formats: https://kubernetes.io/docs/reference/kubectl/#output-options
- Logging: https://kubernetes.io/docs/reference/kubectl/cheatsheet/

### Docker CLI Documentation

- Format options: https://docs.docker.com/engine/cli/formatting/
- Logging: https://docs.docker.com/engine/cli/log-levels/

### Terraform CLI Documentation

- Debug logging: https://developer.hashicorp.com/terraform/internals/debugging

### GitHub CLI Documentation

- JSON output: https://cli.github.com/manual/gh_help_formatting

---

## Appendix: Example Debug Output Formats

### AWS CLI Debug (Text)

```
2024-01-15 10:30:45,123 - MainThread - botocore.endpoint - DEBUG - Making request for OperationModel(name=DescribeInstances) with params: ...
2024-01-15 10:30:45,456 - MainThread - urllib3.connectionpool - DEBUG - https://ec2.us-west-2.amazonaws.com:443 "POST / HTTP/1.1" 200 None
```

### kubectl Debug (Text)

```
I0115 10:30:45.123456   12345 round_trippers.go:553] GET https://kubernetes.default.svc/api/v1/namespaces/default/pods 200 OK in 10 milliseconds
I0115 10:30:45.456789   12345 request.go:1123] Response Body: {"kind":"PodList"...}
```

### Terraform Debug (JSON with TF_LOG_JSON)

```json
{"@level":"debug","@message":"Module installer: install.example","@module":"terraform.module-installer","@timestamp":"2024-01-15T10:30:45.123456Z"}
{"@level":"trace","@message":"Attempting to fetch module from registry","@module":"terraform.registry","@timestamp":"2024-01-15T10:30:45.456789Z"}
```

### Proposed rxc JSONL Debug

```jsonl
{"timestamp":"2024-01-15T10:30:45.123Z","sessionId":"sess-123","turn":1,"step":0,"scope":"provider","phase":"request","message":"Sending request to provider","data":{"model":"claude-3-opus"}}
{"timestamp":"2024-01-15T10:30:45.456Z","sessionId":"sess-123","turn":1,"step":1,"scope":"tool","phase":"execution","message":"Executing tool bash","data":{"command":"ls -la"}}
```