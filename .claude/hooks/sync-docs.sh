#!/usr/bin/env bash
set -e

# Citește JSON de pe stdin
input=$(cat)

# Extrage comanda din tool_input
command=$(echo "$input" | jq -r '.tool_input.command // ""')

# Filtru: doar pe git commit
if [[ "$command" != *"git commit"* ]]; then
  exit 0
fi

# Filtru: dacă commit-ul a eșuat, nu emite reminder
# (PostToolUse fires și pe failure; verifică via tool_response)
exit_code=$(echo "$input" | jq -r '.tool_response.exit_code // 0')
if [[ "$exit_code" != "0" ]]; then
  exit 0
fi

# Cwd din input (sau fallback la PWD)
cwd=$(echo "$input" | jq -r '.cwd // ""')
if [[ -n "$cwd" ]]; then
  cd "$cwd" || exit 0
fi

# Trecere la repo root
repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$repo_root"

# Diff fișiere ultimul commit
diff_files=$(git diff HEAD~1 HEAD --name-only 2>/dev/null) || exit 0

if [[ -z "$diff_files" ]]; then
  exit 0
fi

# Filtru smart: dacă toate fișierele sunt doar docs/landing/config — tăcere
all_doc_or_config=true
while IFS= read -r f; do
  case "$f" in
    landing/*|docs/*|.github/*|.claude/*|*.md|.gitignore|.prettierrc|.eslintrc.js|knip.json|.dependency-cruiser.cjs)
      ;;
    *)
      all_doc_or_config=false
      break
      ;;
  esac
done <<< "$diff_files"

if $all_doc_or_config; then
  exit 0
fi

# Detectează tipuri de schimbare
code_touched=false
privacy_touched=false
schema_touched=false
scripts_touched=false
new_module=false

while IFS= read -r f; do
  case "$f" in
    app/*|services/*|components/*|hooks/*|theme/*)
      code_touched=true
      ;;
  esac
  case "$f" in
    services/aiProvider.ts|services/aiStatement*Mapper.ts|services/cloudStorage.ts|services/cloudSync.ts|services/backup.ts)
      privacy_touched=true
      ;;
  esac
  case "$f" in
    services/db.ts|services/manifestHash.ts)
      schema_touched=true
      ;;
  esac
  case "$f" in
    package.json)
      scripts_touched=true
      ;;
  esac
done <<< "$diff_files"

if ! $code_touched && ! $scripts_touched; then
  exit 0
fi

# Detectează module noi (fișier nou în services/, components/, hooks/)
new_files=$(git diff HEAD~1 HEAD --name-only --diff-filter=A 2>/dev/null || true)
while IFS= read -r f; do
  case "$f" in
    services/*.ts|components/*.tsx|hooks/*.ts)
      new_module=true
      break
      ;;
  esac
done <<< "$new_files"

# Construiește mesajul
commit_msg=$(git log -1 --pretty=%B 2>/dev/null)
files_listed=$(echo "$diff_files" | head -30)
files_count=$(echo "$diff_files" | wc -l | tr -d ' ')

reminder="📋 Sync docs reminder după commit:

Commit:
$commit_msg

Fișiere modificate ($files_count):
$files_listed"

if [[ $files_count -gt 30 ]]; then
  reminder="$reminder
... (trunchiat)"
fi

reminder="$reminder

Verifică și PROPUNE update-uri (nu modifica automat fără confirmare):

1. **docs/IDEAS.md** — feature implementat? Mută/marchează status."

if $code_touched; then
  reminder="$reminder
2. **landing/index.html** — feature user-visible? Actualizează lista features."
fi

if $scripts_touched; then
  reminder="$reminder
3. **CLAUDE.md** — script nou în package.json? Convenție/comandă schimbată?"
fi

if $new_module || $schema_touched; then
  reminder="$reminder
4. **docs/ARCHITECTURE.md** — folder/modul nou sau schemă DB schimbată? Update folder layout sau secțiunea Date."
fi

if $privacy_touched; then
  reminder="$reminder

⚠️  Acest commit atinge cod legat de AI/cloud/backup (privacy-sensitive).
Verifică manual docs/privacy.html și docs/terms.html (când există) sau
marchează în IDEAS.md că e nevoie de privacy review."
fi

# Output JSON conform protocol PostToolUse
jq -n --arg ctx "$reminder" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: $ctx
  }
}'
