import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { ArrowLeft, Feather, Download, Settings, FileText, ChevronUp, ChevronDown, Trash2, Loader2, Play, XCircle, Search } from "lucide-react";
import { useStory, useUpdateManuscript, useWriteStory, useUpdateChapter, useMoveChapter, useDeleteChapter, type StoryChapter, type StoryManuscript } from "@/hooks/use-story";

export default function StoryPage() {
  const { data, isLoading, error } = useStory();
  const writeStory = useWriteStory();
  const updateManuscript = useUpdateManuscript();

  const [activeTab, setActiveTab] = useState<"manuscript" | number>("manuscript");

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-black">
        <div className="text-gold/60 font-serif text-xl animate-pulse">Entering the Chamber...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-black text-red-400">
        <p>Failed to load the manuscript.</p>
        <Link href="/" className="mt-4 text-gold hover:underline">Return Home</Link>
      </div>
    );
  }

  const { manuscript, chapters } = data;
  const isWriting = manuscript.status === "running";

  const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <div className="h-full flex flex-col bg-black text-white/90 overflow-hidden">
      <header className="shrink-0 md:h-14 px-4 py-3 md:py-0 border-b border-gold/15 bg-black/90 flex flex-col md:flex-row items-start md:items-center justify-between z-10 gap-3 md:gap-0">
        <div className="flex flex-wrap items-center gap-4 w-full md:w-auto">
          <Link href="/" className="p-2 rounded-lg text-white/50 hover:text-gold hover:bg-white/5 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex items-center gap-2 text-gold">
            <Feather className="w-5 h-5" />
            <h1 className="font-serif text-lg leading-none">The Scriptorium</h1>
          </div>
          
          <div className="md:ml-4 flex items-center gap-2 md:border-l border-white/10 md:pl-4">
            <span className="text-xs uppercase tracking-widest text-white/40 font-semibold hidden md:inline">Status:</span>
            {manuscript.status === "running" && (
              <span className="text-amber-400 text-sm flex items-center gap-1.5 font-serif italic">
                <Loader2 className="w-4 h-4 animate-spin" /> Ash is writing...
              </span>
            )}
            {manuscript.status === "idle" && (
              <span className="text-white/40 text-sm font-serif italic">Resting</span>
            )}
            {manuscript.status === "incomplete" && (
              <span className="text-blue-400 text-sm font-serif italic">Incomplete run</span>
            )}
            {manuscript.status === "error" && (
              <span className="text-red-400 text-sm flex items-center gap-1.5 font-serif italic">
                <XCircle className="w-4 h-4" /> Error
              </span>
            )}
            {manuscript.lastError && (
              <span className="text-red-400/70 text-xs max-w-xs truncate" title={manuscript.lastError}>
                — {manuscript.lastError}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto pb-1 md:pb-0 shrink-0">
          <button 
            onClick={() => writeStory.mutate()} 
            disabled={isWriting || writeStory.isPending}
            className="flex items-center gap-2 px-4 py-1.5 shrink-0 rounded-lg bg-gold/15 text-gold border border-gold/30 hover:bg-gold/25 transition-colors text-sm font-semibold disabled:opacity-40"
          >
            {isWriting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {manuscript.status === "incomplete" ? "Continue Writing" : "Write Now"}
          </button>
          
          <div className="hidden md:block w-px h-5 bg-white/10 mx-1" />

          <a href={`${baseUrl}/api/story/packet-document`} target="_blank" rel="noreferrer" className="flex items-center shrink-0 gap-2 px-3 py-1.5 rounded-lg text-white/50 hover:text-gold hover:bg-white/5 transition-colors text-sm">
            <Search className="w-4 h-4" /> <span className="hidden sm:inline">Inspect Packet</span>
          </a>
          <a href={`${baseUrl}/api/story/export.docx`} className="flex items-center shrink-0 gap-2 px-3 py-1.5 rounded-lg text-white/50 hover:text-gold hover:bg-white/5 transition-colors text-sm">
            <Download className="w-4 h-4" /> DOCX
          </a>
          <a href={`${baseUrl}/api/story/export.txt`} className="flex items-center shrink-0 gap-2 px-3 py-1.5 rounded-lg text-white/50 hover:text-gold hover:bg-white/5 transition-colors text-sm">
            <FileText className="w-4 h-4" /> TXT
          </a>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        <aside className="w-full md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-gold/10 bg-[#0a0908] flex flex-row md:flex-col overflow-x-auto md:overflow-y-auto">
          <div className="p-2 md:p-4 shrink-0 flex items-center md:items-stretch">
            <button
              onClick={() => setActiveTab("manuscript")}
              className={`flex items-center gap-2 md:gap-3 px-3 py-2 md:py-2.5 rounded-lg transition-colors text-left ${
                activeTab === "manuscript" 
                  ? "bg-gold/10 text-gold border border-gold/20" 
                  : "text-white/60 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Settings className="w-4 h-4 shrink-0" />
              <div className="hidden md:block flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">Manuscript Settings</div>
                <div className="text-[10px] text-white/40 uppercase tracking-wider mt-0.5">Packet & Summary</div>
              </div>
              <span className="md:hidden text-sm font-semibold whitespace-nowrap">Settings</span>
            </button>
          </div>

          <div className="md:px-4 md:pb-2 p-2 flex flex-row md:flex-col gap-2 md:gap-0 shrink-0 items-center md:items-stretch min-w-0">
            <div className="hidden md:block text-[10px] uppercase tracking-widest text-gold/40 font-semibold mb-2 px-1">Chapters</div>
            <div className="flex flex-row md:flex-col gap-1 md:gap-1 w-full">
              {chapters.map((chapter, index) => (
                <ChapterNavItem 
                  key={chapter.id} 
                  chapter={chapter} 
                  isActive={activeTab === chapter.id}
                  onClick={() => setActiveTab(chapter.id)}
                  isFirst={index === 0}
                  isLast={index === chapters.length - 1}
                  locked={isWriting}
                />
              ))}
              {chapters.length === 0 && (
                <div className="text-xs text-white/30 italic px-2 py-4 text-center hidden md:block">No chapters yet</div>
              )}
            </div>
          </div>
        </aside>

        <main className="flex-1 min-w-0 bg-[#0d0c0a] relative flex flex-col overflow-y-auto">
          {activeTab === "manuscript" ? (
            <ManuscriptEditor manuscript={manuscript} />
          ) : (
            <ChapterEditor 
              chapter={chapters.find(c => c.id === activeTab)} 
              readOnly={isWriting}
              key={`chapter-${activeTab}`} 
            />
          )}
        </main>
      </div>
    </div>
  );
}

function ChapterNavItem({ chapter, isActive, onClick, isFirst, isLast, locked }: { chapter: StoryChapter, isActive: boolean, onClick: () => void, isFirst: boolean, isLast: boolean, locked: boolean }) {
  const moveChapter = useMoveChapter();
  const deleteChapter = useDeleteChapter();

  const handleMove = (e: React.MouseEvent, direction: "up" | "down") => {
    e.stopPropagation();
    moveChapter.mutate({ id: chapter.id, direction });
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this chapter?")) {
      deleteChapter.mutate(chapter.id);
    }
  };

  return (
    <div 
      onClick={onClick}
      className={`group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors whitespace-nowrap md:whitespace-normal ${
        isActive ? "bg-white/10 text-gold" : "text-white/60 hover:bg-white/5 hover:text-white"
      }`}
    >
      <div className="truncate text-sm flex-1 min-w-0 font-serif pr-2">
        {chapter.title || "Untitled Chapter"}
        {chapter.status === "unfinished" && <span className="ml-2 text-[10px] text-amber-500 uppercase tracking-widest hidden md:inline">Unfinished</span>}
      </div>
      <div className="flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
        <div className="flex flex-col">
          <button 
            onClick={(e) => handleMove(e, "up")} 
            disabled={locked || isFirst || moveChapter.isPending}
            className="p-0.5 text-white/30 hover:text-white disabled:opacity-30"
          >
            <ChevronUp className="w-3 h-3" />
          </button>
          <button 
            onClick={(e) => handleMove(e, "down")} 
            disabled={locked || isLast || moveChapter.isPending}
            className="p-0.5 text-white/30 hover:text-white disabled:opacity-30"
          >
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>
        <button 
          onClick={handleDelete}
          disabled={locked || deleteChapter.isPending}
          className="p-1.5 ml-1 text-white/30 hover:text-red-400 rounded transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function ManuscriptEditor({ manuscript }: { manuscript: StoryManuscript }) {
  const updateManuscript = useUpdateManuscript();
  const initialized = useRef(false);
  const lastSaved = useRef({ title: "", storyPacket: "", summary: "" });
  
  const [title, setTitle] = useState("");
  const [storyPacket, setStoryPacket] = useState("");
  const [summary, setSummary] = useState("");

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      setTitle(manuscript.title || "");
      setStoryPacket(manuscript.storyPacket || "");
      setSummary(manuscript.summary || "");
      lastSaved.current = { 
        title: manuscript.title || "", 
        storyPacket: manuscript.storyPacket || "", 
        summary: manuscript.summary || "" 
      };
    }
  }, [manuscript]);

  const mutateFnRef = useRef(updateManuscript.mutate);
  mutateFnRef.current = updateManuscript.mutate;

  useEffect(() => {
    if (!initialized.current) return;
    const timeout = setTimeout(() => {
      const current = { title, storyPacket, summary };
      if (
        current.title !== lastSaved.current.title || 
        current.storyPacket !== lastSaved.current.storyPacket || 
        current.summary !== lastSaved.current.summary
      ) {
        mutateFnRef.current(current);
        lastSaved.current = current;
      }
    }, 1000);
    return () => clearTimeout(timeout);
  }, [title, storyPacket, summary]);

  const isSaving = updateManuscript.isPending;

  return (
    <div className="flex-1 overflow-y-auto px-8 py-10 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between mb-8">
        <h2 className="font-serif text-3xl text-gold/90">Manuscript Settings</h2>
        {isSaving && <span className="text-xs text-white/40 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin"/> Saving...</span>}
      </div>

      <div className="space-y-8">
        <section>
          <label className="block text-xs uppercase tracking-widest text-gold/60 font-semibold mb-2">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-white/5 border border-white/10 focus:border-gold/40 rounded-xl px-4 py-3 text-lg font-serif text-white outline-none transition-colors"
            placeholder="Untitled Manuscript"
          />
        </section>

        <section>
          <div className="flex justify-between items-end mb-2">
            <label className="block text-xs uppercase tracking-widest text-gold/60 font-semibold">Story Packet</label>
            <span className="text-[10px] text-white/30">Auto-saves</span>
          </div>
          <p className="text-sm text-white/40 mb-3 leading-relaxed">
            The guiding rules, themes, outline, and cast for this book. Ash refers to this before writing every chapter. (Also editable via Persona Packet).
          </p>
          <textarea
            value={storyPacket}
            onChange={(e) => setStoryPacket(e.target.value)}
            spellCheck={false}
            className="w-full h-80 bg-[#080706] border border-white/10 focus:border-gold/40 rounded-xl px-5 py-4 text-[15px] leading-relaxed text-white/80 font-mono outline-none transition-colors resize-y"
            placeholder="Outline and rules..."
          />
        </section>

        <section>
          <div className="flex justify-between items-end mb-2">
            <label className="block text-xs uppercase tracking-widest text-gold/60 font-semibold">Rolling Summary</label>
            <span className="text-[10px] text-white/30">Auto-saves</span>
          </div>
          <p className="text-sm text-white/40 mb-3 leading-relaxed">
            What has happened so far. Ash updates this automatically after writing each chapter to maintain continuity.
          </p>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            spellCheck={false}
            className="w-full h-64 bg-[#080706] border border-white/10 focus:border-gold/40 rounded-xl px-5 py-4 text-[15px] leading-relaxed text-white/80 font-mono outline-none transition-colors resize-y"
            placeholder="The story thus far..."
          />
        </section>
      </div>
    </div>
  );
}

function ChapterEditor({ chapter, readOnly = false }: { chapter?: StoryChapter; readOnly?: boolean }) {
  const updateChapter = useUpdateChapter();
  
  const initializedForId = useRef<number | null>(null);
  const lastSaved = useRef({ title: "", content: "" });
  
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  useEffect(() => {
    if (chapter && (initializedForId.current !== chapter.id || readOnly)) {
      initializedForId.current = chapter.id;
      setTitle(chapter.title || "");
      setContent(chapter.content || "");
      lastSaved.current = { title: chapter.title || "", content: chapter.content || "" };
    }
  }, [chapter?.id, chapter?.title, chapter?.content, readOnly]);

  const mutateFnRef = useRef(updateChapter.mutate);
  mutateFnRef.current = updateChapter.mutate;

  useEffect(() => {
    if (initializedForId.current !== chapter?.id) return;
    const timeout = setTimeout(() => {
      if (title !== lastSaved.current.title || content !== lastSaved.current.content) {
        mutateFnRef.current({ id: chapter.id, data: { title, content } });
        lastSaved.current = { title, content };
      }
    }, 1000);
    return () => clearTimeout(timeout);
  }, [title, content, chapter?.id]);

  if (!chapter) {
    return (
      <div className="flex-1 flex items-center justify-center text-white/30 italic font-serif">
        Chapter not found.
      </div>
    );
  }

  const isSaving = updateChapter.isPending;

  return (
    <div className="flex-1 flex flex-col overflow-hidden max-w-5xl mx-auto w-full relative">
      <div className="absolute top-4 right-6 flex items-center gap-2 z-10 pointer-events-none">
        {isSaving && <span className="text-[10px] uppercase tracking-widest text-white/30 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin"/> Saving</span>}
        {readOnly && <span className="text-[10px] uppercase tracking-widest text-amber-400">Locked while Ash writes</span>}
      </div>

      <div className="shrink-0 px-4 md:px-10 pt-8 md:pt-12 pb-4 md:pb-6">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          readOnly={readOnly}
          className="w-full bg-transparent border-none text-2xl md:text-4xl font-serif text-gold/90 placeholder:text-gold/20 outline-none text-center"
          placeholder="Chapter Title"
        />
        {chapter.status === "unfinished" && (
          <div className="text-center mt-2">
            <span className="text-xs uppercase tracking-widest text-amber-500 font-semibold border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 rounded-full">
              Unfinished
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 px-4 md:px-10 pb-12 overflow-y-auto">
        {chapter.continuation && (
          <div className="mb-6 p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 text-sm font-mono text-amber-500/70 whitespace-pre-wrap leading-relaxed">
            <div className="text-[10px] uppercase tracking-widest text-amber-500/50 mb-2 font-sans font-semibold">Continuation Prompt</div>
            {chapter.continuation}
          </div>
        )}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          readOnly={readOnly}
          spellCheck={false}
          className="w-full h-full min-h-[500px] bg-transparent border-none text-[15px] md:text-[17px] leading-[1.8] text-white/85 font-serif outline-none resize-none"
          placeholder="Write the chapter content here..."
        />
      </div>
    </div>
  );
}
