#!/usr/bin/env python3
"""Offline, synthetic 5000-document / 20000-asset fixture; never opens a real workspace.
Requires the empty seed database and editor-produced attachment template from the audit.
"""
import argparse, hashlib, json, re, shutil, sqlite3, urllib.parse
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument('--seed', required=True)
ap.add_argument('--template', required=True)
ap.add_argument('--output', required=True)
a = ap.parse_args()
seed, out = Path(a.seed).resolve(), Path(a.output).resolve()
if not str(seed).startswith(('/tmp/lake-packaged-perf-seed-', '/private/tmp/lake-packaged-perf-seed-')):
    raise SystemExit('seed must be an isolated /tmp/lake-packaged-perf-seed-* directory')
if not str(out).startswith(('/tmp/lake-packaged-perf-fixture-', '/private/tmp/lake-packaged-perf-fixture-')) or out.exists():
    raise SystemExit('output must be a new /tmp/lake-packaged-perf-fixture-* directory')
shutil.copytree(seed, out)
root = out / 'workspace-default'
c = sqlite3.connect(root / 'metadata.sqlite3')
# 261029 Del-6：declared_assets / sync_base 已从 schema 删除（旧库可能残留空表）⇒ 只清仍存在的表。
def table_exists(name):
    return c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None
for t in ('notes', 'tree_nodes', 'orphan_assets', 'declared_assets', 'sync_base', 'deleted_notes', 'note_history', 'search_index', 'notes_fts'):
    if table_exists(t):
        c.execute('DELETE FROM ' + t)
c.execute('DELETE FROM settings')
c.execute("INSERT INTO settings VALUES('sync_settings',?)", (json.dumps({'enabled': False, 'autoMode': 'manual', 'autoIntervalMinutes': 15}),))
c.execute("DELETE FROM device_state WHERE key NOT IN ('seed_initialized')")
c.execute("INSERT INTO device_state VALUES('last_opened_note_id','perf-doc-small')")
for name in ('notes', 'usheets', 'bitables', 'boards', 'note-assets', 'history'):
    p = root / name
    if p.exists(): shutil.rmtree(p)
    p.mkdir()
# Device-local view state from seeding is not part of the cold fixture.
for name in ('Local Storage', 'Code Cache', 'Cache', 'GPUCache', 'DawnGraphiteCache'):
    p = out / name
    if p.exists(): shutil.rmtree(p)

now = '2026-10-13T00:00:00.000Z'
folders = []
def folder(i, title, parent=None, kind='notebook', order=0):
    c.execute("INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,sort_order,created_at,updated_at,sync_state) VALUES(?,'default',?,?,?,?,?,?,'synced')", (i,parent,kind,title,order,now,now))
    if i != 'notebook-trash': folders.append({'id':i,'title':title,'parentId':parent,'nodeType':kind,'sortOrder':order,'updatedAt':now,'isConflict':False})
folder('notebook-trash','回收站')
folder('notebook-personal','性能验收')
for n in range(10):
    folder(f'perf-nb-{n}', f'合成笔记本 {n+1}', order=n+1)
    for g in range(5): folder(f'perf-group-{n}-{g}',f'分组 {g+1}',f'perf-nb-{n}','group',g)

template = json.loads(Path(a.template).read_text())
match = re.search(r'<card type="inline" name="file" value="data:([^"]+)"></card>', template['canonical'])
if not match: raise SystemExit('template must contain an editor-produced file card')
card_template = json.loads(urllib.parse.unquote(match.group(1)))
asset_bytes = b'A' * 4096
asset_hash = hashlib.sha256(asset_bytes).hexdigest()
notes, bodies = [], {}
plain = '本地优先笔记性能验收。离线编辑、附件管理、历史快照与目录组织。'
def para(i, text):
    return f'<p data-lake-id="u{i:08x}" id="u{i:08x}" class="ne-p"><span data-lake-id="u{i+1:08x}" id="u{i+1:08x}">{text}</span></p>'
def text_body(target):
    count = max(1, target // 400)
    return ''.join(para(0x110000 + i*2, plain*3 + str(i)) for i in range(count))

def add(note_id, title, kind='doc', body=None, parent='notebook-personal', order=0, asset_count=4):
    if body is None: body = text_body(2048)
    assets = []
    if kind == 'doc':
        directory = root / 'note-assets' / note_id
        directory.mkdir()
        for j in range(asset_count):
            filename = f'1791849600000_{asset_hash[:8]}_{j}.txt'
            (directory/filename).write_bytes(asset_bytes)
            value = dict(card_template)
            value.update(src=f'http://127.0.0.1:19876/{note_id}/{filename}',name=f'合成附件-{j}.txt',size=len(asset_bytes),id=f'u{0x700000+j:08x}',taskId=f'perf-{note_id}-{j}')
            encoded = urllib.parse.quote(json.dumps(value,ensure_ascii=False,separators=(',',':')),safe='')
            body += f'<p id="u{0x800000+j:08x}" data-lake-id="u{0x800000+j:08x}"><card type="inline" name="file" value="data:{encoded}"></card></p>'
            assets.append({'filename':filename,'size':len(asset_bytes),'hash':asset_hash})
    ext, directory = {'doc':('lake','notes'),'usheet':('usheet.json','usheets'),'bitable':('bitable.json','bitables'),'board':('board.json','boards')}[kind]
    (root/directory/f'{note_id}.{ext}').write_text(body)
    content_hash = hashlib.sha256(body.encode()).hexdigest()
    c.execute("INSERT INTO notes(id,title,parent_id,sort_order,updated_at,sync_state,kind,text_cache,md_cache) VALUES(?,?,?,?,?,'synced',?,?,?)",(note_id,title,parent,order,now,kind,plain,plain))
    c.execute("INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,sync_state) VALUES(?,'default',?,'note',?,?,?,?,?,'synced')",(note_id,parent,title,note_id,order,now,now))
    rowid = len(notes)+1
    # Ledger prevents unrelated FTS rebuild work on every audited launch; search itself is out of scope.
    title_hash=hashlib.sha256(title.encode()).hexdigest(); body_hash=hashlib.sha256(plain.encode()).hexdigest()
    c.execute('INSERT INTO notes_fts(rowid,title,body) VALUES(?,?,?)',(rowid,' '.join(title),' '.join(plain)))
    c.execute('INSERT INTO search_index VALUES(?,?,?,?,?)',(note_id,rowid,title_hash,body_hash,now))
    entry={'id':note_id,'title':title,'parentId':parent,'sortOrder':order,'updatedAt':now,'contentHash':content_hash,'isConflict':False,'assets':assets}
    if kind!='doc':entry['kind']=kind
    notes.append(entry); bodies[note_id]={'kind':kind,'bytes':len(body.encode()),'assets':len(assets),'file':str(root/directory/f'{note_id}.{ext}')}

def sheet(rows):
    value=json.loads(template['seeds']['sheet']['content']); s=value['workbook']['sheets']['s1'];s['rowCount']=rows;s['columnCount']=20
    s['cellData']={str(r):{str(col):{'v':f'R{r+1}C{col+1}' if col==0 else (r+col)%1000,'t':1 if col==0 else 2} for col in range(20)} for r in range(rows)}
    return json.dumps(value,separators=(',',':'))
def bitable(rows):
    value=json.loads(template['seeds']['bitable']['content']);t=value['tables'][0];t['id']='perf-table';value['activeTableId']=t['id']
    t['fields']=[{'id':f'f{col}','name':f'字段{col+1}','type':'text' if col==0 else 'number'} for col in range(20)]
    t['records']=[{'id':f'r{r}','values':{f'f{col}':f'记录{r+1}' if col==0 else r+col for col in range(20)},'createdAt':now,'updatedAt':now} for r in range(rows)]
    return json.dumps(value,ensure_ascii=False,separators=(',',':'))
def board():
    value=json.loads(template['seeds']['board']['content'])
    value['elements']=[{'id':f'box{i}','type':'geometry','shape':'rectangle','points':[[float((i%10)*150),float((i//10)*90)],[float((i%10)*150+120),float((i//10)*90+60)]],'fill':'#ffffff','strokeColor':'#666666','strokeWidth':2} for i in range(100)]
    return json.dumps(value,separators=(',',':'))
special=[('perf-doc-small','普通富文本','doc',text_body(2048)),('perf-doc-512k','长文约512KB','doc',text_body(512*1024)),('perf-doc-2m','长文约2MB','doc',text_body(2*1024*1024)),('perf-doc-media','24附件文档','doc',text_body(1024)),('perf-sheet-1000','表格1000×20','usheet',sheet(1000)),('perf-sheet-5000','表格5000×20','usheet',sheet(5000)),('perf-bitable-200','多维表200×20','bitable',bitable(200)),('perf-bitable-5000','多维表5000×20','bitable',bitable(5000)),('perf-board-100','画板100图形','board',board())]
for i,(note_id,title,kind,body) in enumerate(special):add(note_id,title,kind,body,order=i,asset_count=24 if note_id=='perf-doc-media' else 4)
for i in range(5000-len(special)):
    add(f'perf-note-{i:04d}',f'合成笔记 {i:04d}',parent=f'perf-group-{i%10}-{(i//10)%5}',order=i//50)
c.commit();c.execute('PRAGMA wal_checkpoint(TRUNCATE)');c.close()
manifest={'version':1,'workspaceId':'default','commitId':'perf-initial','prevCommitId':None,'createdAt':now,'notes':notes,'folders':folders}
(out/'remote-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')))
summary={'documents':len(notes),'assetFiles':sum(x['assets'] for x in bodies.values()),'assetBytes':sum(x['assets'] for x in bodies.values())*4096,'noteBodyBytes':sum(x['bytes'] for x in bodies.values()),'specials':{k:bodies[k] for k,*_ in special},'seed':str(seed),'output':str(out),'assetTemplate':'editor-produced file card; copied field set with per-note URL/filename/IDs','limitations':['Synthetic 4KiB attachments (not 20GB transfer)','FTS ledger populated; search performance excluded','No real cloud/credentials']}
(out/'fixture.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2));print(json.dumps(summary,ensure_ascii=False,indent=2))
