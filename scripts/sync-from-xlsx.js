#!/usr/bin/env node
/**
 * Offline helper: rebuild data/*.json from a local .xlsx export of the tracker.
 * Usage: node scripts/sync-from-xlsx.js [path/to/Solutions_Demo_Tracker.xlsx]
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const xlsx =
  process.argv[2] ||
  path.join(process.env.HOME || '', 'Downloads', 'Solutions_Demo_Tracker.xlsx');
const outDir = path.join(__dirname, '..', 'data');

if (!fs.existsSync(xlsx)) {
  console.error('File not found:', xlsx);
  process.exit(1);
}

const py = `
import openpyxl, json, re, sys
from pathlib import Path
from datetime import datetime, date
xlsx, out = Path(sys.argv[1]), Path(sys.argv[2])
wb = openpyxl.load_workbook(xlsx, data_only=True)

def cell(v):
    if v is None: return ''
    if isinstance(v, (datetime, date)):
        try: return v.strftime('%b %d, %Y')
        except Exception: return str(v)
    return str(v).strip()

def header(ws, needles):
    for i, row in enumerate(ws.iter_rows(values_only=True), 1):
        vals = [cell(x) for x in row]
        j = ' | '.join(vals).lower()
        if all(n.lower() in j for n in needles):
            return i
    return 1

demos = []
ws = wb['Demo Tracker']
hr = header(ws, ['Owner', 'Demo Name'])
for i, row in enumerate(ws.iter_rows(values_only=True), 1):
    if i <= hr: continue
    vals = [cell(x) for x in row]
    while len(vals) < 15: vals.append('')
    if not vals[0] or not vals[1]: continue
    notes = vals[14]
    if re.search(r'1password|vault|password|credential', notes, re.I):
        notes = ''
    demos.append({
        'owner': vals[0], 'name': vals[1], 'stage': vals[2], 'use_case': vals[3],
        'industry': vals[4], 'products': vals[5], 'pain_value': vals[6],
        'brief': vals[7], 'demo_link': vals[8], 'github': vals[9],
        'recording': vals[10], 'status': vals[11] or 'Idea', 'date': vals[12],
        'feedback': vals[13], 'notes': notes
    })

profiles = {}
if 'SA Profiles' in wb.sheetnames:
    ws = wb['SA Profiles']
    hr = header(ws, ['Name'])
    for i, row in enumerate(ws.iter_rows(values_only=True), 1):
        if i <= hr: continue
        vals = [cell(x) for x in row]
        while len(vals) < 7: vals.append('')
        if not vals[0]: continue
        profiles[vals[0]] = {
            'title': vals[1] or 'Solutions Architect', 'location': vals[2],
            'bio': vals[3], 'photo': vals[4], 'linkedin': vals[5], 'github': vals[6]
        }

content = []
for tab, typ in [('KB', 'KB'), ('Blog post', 'Blog')]:
    if tab not in wb.sheetnames: continue
    ws = wb[tab]
    hr = header(ws, ['Owner'])
    for i, row in enumerate(ws.iter_rows(values_only=True), 1):
        if i <= hr: continue
        vals = [cell(x) for x in row]
        while len(vals) < 6: vals.append('')
        if not vals[0] or not vals[1]: continue
        content.append({
            'type': typ, 'owner': vals[0], 'title': vals[1], 'link': vals[2],
            'use_case': vals[3], 'industry': vals[4], 'products': vals[5]
        })

out.mkdir(parents=True, exist_ok=True)
(out/'demos.json').write_text(json.dumps(demos, indent=2))
(out/'profiles.json').write_text(json.dumps(profiles, indent=2))
(out/'content.json').write_text(json.dumps(content, indent=2))
print(f'Wrote {len(demos)} demos, {len(profiles)} profiles, {len(content)} content rows')
`;

execFileSync('python3', ['-c', py, xlsx, outDir], { stdio: 'inherit' });
