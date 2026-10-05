# Reads KEY=value lines from a local secrets file as plain text, never as shell code
# (hosted database URLs contain "&", which a shell would treat as an operator), and
# exports only the keys it is asked for. Optional surrounding quotes are removed.
#   read_env_file <file> KEY1 KEY2 ...
read_env_file() {
  local file=$1 line key value; shift
  [[ -f "$file" ]] || { echo "$file not found." >&2; return 1; }
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    key="${line%%=*}" value="${line#*=}"
    [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]] && value="${BASH_REMATCH[1]}"
    if [[ " $* " == *" $key "* ]]; then export "$key=$value"; else echo "Ignoring unknown key in $file: $key" >&2; fi
  done < "$file"
}
