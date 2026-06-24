import json, sys, os
from datetime import date

ITEMS_FILE = os.environ.get('ITEMS_FILE', '/tmp/gospel-new-items.json')
STATE_FILE = os.environ.get('STATE_FILE', 'data/gospel-alerts-state.txt')
REPORT_FILE = os.environ.get('REPORT_FILE', 'data/ga-latest.md')
REPORT_URL = os.environ.get('REPORT_URL', 'https://github.com/Imisibamiro/atlas-core/blob/main/data/ga-latest.md')

# Load items
items = []
with open(ITEMS_FILE) as f:
    for line in f:
        line = line.strip()
        if line:
            items.append(json.loads(line))

if not items:
    print("No items, nothing to report")
    sys.exit(0)

today = date.today().isoformat()

# Group by type
groups = {}
type_order = ['🎵 New Music', '💿 Album/EP', '🎵 Mixtape', '🎬 Video', '📰 News', '📖 Devotional', '📢 News']
for item in items:
    groups.setdefault(item['type'], []).append(item)

# ============================================================
# 1. Build the full markdown report (committed to repo)
# ============================================================
md = f"# GA Daily Report — {today}\n\n"
md += f"**{len(items)}** new items from 7 Nigerian gospel blogs\n\n"
md += "---\n\n"

site_counts = {}
for item in items:
    site_counts[item['source']] = site_counts.get(item['source'], 0) + 1

md += "### By Source\n"
for src, cnt in sorted(site_counts.items(), key=lambda x: -x[1]):
    md += f"- {src}: {cnt}\n"

md += "\n### By Category\n"
for t in type_order:
    if t not in groups:
        continue
    md += f"\n## {t} ({len(groups[t])})\n\n"
    for item in groups[t]:
        link = item['link']
        title = item['title']
        date_str = item['date']
        source = item['source']
        if link:
            md += f"- [{title}]({link}) — _{source}_\n"
        else:
            md += f"- {title} — _{source}_\n"

with open(REPORT_FILE, 'w') as f:
    f.write(md)
print(f"Report written: {REPORT_FILE} ({len(md)} bytes)")

# ============================================================
# 2. Build Discord embed (compact + link to full report)
# ============================================================
GITHUB_SERVER = os.environ.get('GITHUB_SERVER_URL', 'https://github.com')
GITHUB_REPO = os.environ.get('GITHUB_REPOSITORY', 'Imisibamiro/atlas-core')
GITHUB_SHA = os.environ.get('GITHUB_SHA', 'main')
report_link = f"{GITHUB_SERVER}/{GITHUB_REPO}/blob/{GITHUB_SHA}/{REPORT_FILE}"

fields = []
MAX_PER_FIELD = 5  # show max 5 per type in the embed

for t in type_order:
    if t not in groups:
        continue
    group = groups[t]
    total = len(group)
    
    value_lines = []
    char_count = 0
    
    for item in group[:MAX_PER_FIELD]:
        title = item['title'][:80]
        link = item['link']
        if link:
            line = f'[{title}]({link})'
        else:
            line = title
        # Check if adding this line exceeds ~950 chars (leave room for extra)
        if char_count + len(line) > 900:
            break
        value_lines.append(line)
        char_count += len(line)
    
    shown = len(value_lines)
    remaining = total - shown
    
    if remaining > 0:
        # Make "X more" a clickable link to the full report
        value_lines.append(f'[▶ See all {total} items]({report_link})')
    
    fields.append({
        'name': f'{t} ({total})',
        'value': '\n'.join(value_lines),
        'inline': False
    })
    
    if len(fields) >= 8:
        break

# Description with link to full report
desc = f"**{len(items)}** new items — [📄 View full report]({report_link})"

payload = {
    'username': '🎵 GA',
    'embeds': [{
        'title': f'GA Daily — {today}',
        'color': 0x00AA66,
        'description': desc,
        'fields': fields,
        'footer': {'text': 'GA · NGMC'},
        'timestamp': os.environ.get('NOW_ISO', date.today().isoformat() + 'T00:00:00Z')
    }]
}

# Write payload for Discord
payload_file = os.environ.get('PAYLOAD_FILE', '/tmp/discord-payload.json')
with open(payload_file, 'w') as f:
    json.dump(payload, f)

print(f"Discord payload written: {payload_file} ({len(json.dumps(payload))} bytes)")
print(f"Report URL: {report_link}")
