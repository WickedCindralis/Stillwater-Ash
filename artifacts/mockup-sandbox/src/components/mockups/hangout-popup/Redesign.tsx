import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Image as ImageIcon, Minus, Settings, X } from "lucide-react";
import "./_group.css";

type Message = {
  id: number;
  author: "Ash" | "You";
  text: string;
  time: string;
  screenshot?: boolean;
};

const initialMessages: Message[] = [
  { id: 1, author: "Ash", text: "I'm here. Take your time — what are you looking at?", time: "2:14 PM" },
  { id: 2, author: "You", text: "Can you see the screen now?", time: "2:15 PM" },
  {
    id: 3,
    author: "Ash",
    text: "I can see the playlist and the browser beside it. The screenshot stays small here, so our conversation has room to breathe. If I have more to say, this entire reply stays visible in the bubble — only the conversation scrolls.",
    time: "2:15 PM",
    screenshot: true,
  },
];

export function Redesign() {
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState(true);
  const [visible, setVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keepOnTop, setKeepOnTop] = useState(true);
  const [minutes, setMinutes] = useState("15");
  const [savedMinutes, setSavedMinutes] = useState("15");
  const [imageOpen, setImageOpen] = useState(false);
  const [hangoutActive, setHangoutActive] = useState(true);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages, expanded]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "20px";
    input.style.height = `${Math.min(input.scrollHeight, 68)}px`;
  }, [draft]);

  function send() {
    const text = draft.trim();
    if (!text || !hangoutActive) return;
    setMessages((current) => [...current, { id: Date.now(), author: "You", text, time: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) }]);
    setDraft("");
  }

  return (
    <main className="hangout-stage">
      <div className="hangout-stage-decoration" aria-hidden="true">
        <span className="hangout-stage-mark">Stillwater</span>
        <span className="hangout-stage-line" />
        <span className="hangout-stage-line short" />
      </div>
      {!visible ? (
        <button className="hangout-reopen" onClick={() => setVisible(true)}>Open Hangout</button>
      ) : (
        <section className={`hangout-window ${expanded ? "" : "is-collapsed"}`} aria-label="Hangout pop-up">
          <header className="hangout-header">
            <button
              className="hangout-identity"
              onClick={() => { setExpanded((value) => !value); setSettingsOpen(false); }}
              aria-label={expanded ? "Minimize Hangout" : "Expand Hangout"}
            >
              <span className="hangout-avatar">A</span>
              <span className="hangout-person">
                <strong>Ash</strong>
                <small><span className={`hangout-status-dot ${hangoutActive ? "" : "is-idle"}`} />{hangoutActive ? "Hangout active" : "Hangout stopped"}</small>
              </span>
            </button>
            <nav className="hangout-actions" aria-label="Window controls">
              <button title="Settings" aria-label="Settings" onClick={() => { setExpanded(true); setSettingsOpen((value) => !value); }}><Settings size={16} /></button>
              <button title={expanded ? "Minimize to header" : "Expand Hangout"} aria-label={expanded ? "Minimize to header" : "Expand Hangout"} onClick={() => { setExpanded((value) => !value); setSettingsOpen(false); }}><Minus size={16} /></button>
              <button title="Close window" aria-label="Close window" onClick={() => { setVisible(false); setSettingsOpen(false); }}><X size={17} /></button>
            </nav>
          </header>
          {expanded && (
            <>
              {settingsOpen && (
                <div className="hangout-settings" role="group" aria-label="Hangout settings">
                  <strong>Hangout settings</strong>
                  <label className="hangout-topmost">
                    <input type="checkbox" checked={keepOnTop} onChange={(event) => setKeepOnTop(event.target.checked)} />
                    <span>Keep on top</span>
                  </label>
                  <label className="hangout-minutes-label" htmlFor="hangout-minutes">Screenshot interval (minutes)</label>
                  <div className="hangout-minutes-row">
                    <input id="hangout-minutes" type="number" min="1" max="1440" value={minutes} onChange={(event) => setMinutes(event.target.value)} />
                    <button onClick={() => { if (Number(minutes) >= 1 && Number(minutes) <= 1440) setSavedMinutes(minutes); }} disabled={minutes === savedMinutes} aria-label="Save minutes">
                      {minutes === savedMinutes ? <Check size={14} /> : "Apply"}
                    </button>
                  </div>
                  <button className="hangout-stop" onClick={() => { setHangoutActive(false); setSettingsOpen(false); }}>Stop Hangout</button>
                </div>
              )}
              <div className="hangout-thread" ref={threadRef} aria-label="Conversation">
                {messages.map((message) => (
                  <div className={`hangout-message ${message.author === "You" ? "from-you" : "from-ash"}`} key={message.id}>
                    <div className="hangout-bubble">
                      <div className="hangout-message-text">{message.text}</div>
                      {message.screenshot && (
                        <button className="hangout-thumbnail" onClick={() => setImageOpen(true)} aria-label="View screenshot full size" title="View screenshot full size">
                          <div className="hangout-screenshot-art" aria-hidden="true">
                            <div className="hangout-screenshot-sidebar" />
                            <div className="hangout-screenshot-browser">
                              <div /><div /><div /><div />
                            </div>
                          </div>
                          <ImageIcon size={13} className="hangout-thumbnail-icon" />
                        </button>
                      )}
                    </div>
                    <time title={`${message.author} · ${message.time}`}>{message.time}</time>
                  </div>
                ))}
              </div>
              <div className="hangout-composer">
                <div className="hangout-input-frame">
                  <textarea
                    ref={inputRef}
                    rows={1}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); }
                    }}
                    placeholder={hangoutActive ? "Write a message…" : "Hangout stopped"}
                    disabled={!hangoutActive}
                    aria-label="Message"
                  />
                </div>
                <button className="hangout-send" onClick={send} disabled={!draft.trim() || !hangoutActive} aria-label="Send message"><ArrowUp size={17} /></button>
              </div>
            </>
          )}
        </section>
      )}
      {imageOpen && (
        <div className="hangout-preview-backdrop" role="dialog" aria-modal="true" aria-label="Full-size screenshot" onClick={() => setImageOpen(false)}>
          <div className="hangout-preview-window" onClick={(event) => event.stopPropagation()}>
            <div className="hangout-preview-toolbar"><span>Hangout screenshot</span><button onClick={() => setImageOpen(false)} aria-label="Close screenshot"><X size={18} /></button></div>
            <div className="hangout-preview-art">
              <div className="hangout-preview-sidebar" />
              <div className="hangout-preview-browser">
                <div className="hangout-preview-address" />
                <div className="hangout-preview-block" />
                <div className="hangout-preview-block small" />
                <div className="hangout-preview-block" />
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}