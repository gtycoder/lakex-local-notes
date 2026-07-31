import { FileText, Plus, Search } from "lucide-react";
import type { NoteSummary, SyncStatus } from "../lib/types";

interface MobileLibraryProps {
  notes: NoteSummary[];
  search: string;
  sync: SyncStatus;
  onSearch: (value: string) => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function MobileLibrary(props: MobileLibraryProps) {
  const visible = props.notes.filter((note) => note.title.toLocaleLowerCase().includes(props.search.toLocaleLowerCase()));
  return (
    <main className="mobile-library">
      <header className="mobile-library-header">
        <div><span>Lake Notes</span><h1>文档</h1></div>
      </header>
      <div className="mobile-library-search"><Search size={18} /><input value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder="搜索文档" /></div>
      <section className="mobile-note-list">
        {visible.map((note) => (
          <button key={note.id} className="mobile-note-row" onClick={() => props.onSelect(note.id)}>
            <span className="mobile-note-icon"><FileText size={19} /></span>
            <span className="mobile-note-copy"><strong>{note.title}</strong><small>{formatTime(note.updatedAt)}</small></span>
            <span className={`sync-dot ${note.syncState}`} />
          </button>
        ))}
        {visible.length === 0 && <div className="empty-list">没有匹配的文档</div>}
      </section>
      <button className="mobile-create-button" onClick={props.onCreate} title="新建文档"><Plus size={24} /></button>
      <footer className="mobile-library-status">{props.sync.message}</footer>
    </main>
  );
}

function formatTime(value: string): string {
  return new Date(value).toLocaleDateString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
