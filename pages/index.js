/* pages/index.js */
import { useEffect, useRef, useState } from "react";
import Head from "next/head";

const INSTRUCTORS_API_URL = "/api/instructors";
const MAKE_WEBHOOK_URL = "https://hook.eu1.make.com/8eo529jglgiqrehsdm0k8rtul68jsmox";
const MAKE_CONFIRM_WEBHOOK_URL = "PASTE_CONFIRM_WEBHOOK";
const MAKE_CHAT_WEBHOOK_URL = "PASTE_CHAT_WEBHOOK";

const CONVERSATION_KEY = "fd_conversation_id";
const CHAT_STORAGE_KEY = "fd_chat_session_id";

function getConversationId() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(CONVERSATION_KEY);
}
function setConversationId(id) {
  if (typeof window === "undefined") return;
  if (id) window.localStorage.setItem(CONVERSATION_KEY, id);
}

function getOrCreateChatSessionId() {
  if (typeof window === "undefined") return null;
  const existing = window.localStorage.getItem(CHAT_STORAGE_KEY);
  if (existing) return existing;
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : "chat_" + Date.now();
  window.localStorage.setItem(CHAT_STORAGE_KEY, id);
  return id;
}

function safeText(v) {
  return (v ?? "").toString();
}
function isSchemaString(v) {
  if (!v) return false;
  const s = v.toString().trim();
  return s === '{"type":"string"}' || s.includes('"type":"string"');
}
function normalizeMessage(rawMsg) {
  const s = safeText(rawMsg);
  if (!s) return "Richiesta ricevuta.";
  if (isSchemaString(s)) return "Ok. Per procedere mi servono alcune info.";
  return s;
}
function formatSlot(startISO, endISO) {
  try {
    const start = new Date(startISO);
    const end = new Date(endISO);
    const date = start.toLocaleDateString("it-IT", { day: "2-digit", month: "long" });
    const startTime = start.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    const endTime = end.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    return `${date} · ${startTime} - ${endTime}`;
  } catch {
    return "Alternativa disponibile";
  }
}

export default function Home() {
  // stato principale
  const [instructors, setInstructors] = useState([]);
  const [instructorsLoading, setInstructorsLoading] = useState(true);
  const [selectedInstructorId, setSelectedInstructorId] = useState("");
  const [selectedInstructor, setSelectedInstructor] = useState(null);

  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");

  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [altVisible, setAltVisible] = useState(false);
  const [altMsg, setAltMsg] = useState("");
  const [altMeta, setAltMeta] = useState("");
  const [altAlternatives, setAltAlternatives] = useState([]);

  const [sending, setSending] = useState(false);

  // mini‑chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatText, setChatText] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatMissingFields, setChatMissingFields] = useState([]);
  const [chatDraftFields, setChatDraftFields] = useState({});
  const [chatSessionId, setChatSessionIdState] = useState(null);

  const [lastBasePayload, setLastBasePayload] = useState(null);

  const chatBodyRef = useRef(null);

  // init
  useEffect(() => {
    setChatSessionIdState(getOrCreateChatSessionId());
    loadInstructors();
  }, []);

  function resetFeedback() {
    setSuccessMsg("");
    setErrorMsg("");
    setAltVisible(false);
    setAltMsg("");
    setAltMeta("");
    setAltAlternatives([]);
  }

  async function loadInstructors() {
    setInstructorsLoading(true);
    resetFeedback();

    try {
      const res = await fetch(INSTRUCTORS_API_URL, { method: "GET" });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json || json.ok !== true) {
        const msg = json?.error ? String(json.error) : "HTTP " + res.status;
        setErrorMsg("Non riesco a caricare la lista maestri.\n" + msg);
        setInstructors([]);
        setInstructorsLoading(false);
        return;
      }

      const data = Array.isArray(json.data) ? json.data : [];
      setInstructors(data);
      setInstructorsLoading(false);
    } catch (err) {
      console.error("Errore loadInstructors:", err);
      setErrorMsg("Errore rete nel caricamento maestri.");
      setInstructorsLoading(false);
    }
  }

  async function handleSelectChange(e) {
    const id = e.target.value;
    setSelectedInstructorId(id);
    resetFeedback();

    if (!id) {
      setSelectedInstructor(null);
      return;
    }

    try {
      const url = INSTRUCTORS_API_URL + "?id=" + encodeURIComponent(id);
      const res = await fetch(url, { method: "GET" });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json || json.ok !== true || !json.data) {
        const msg = json?.error ? String(json.error) : "HTTP " + res.status;
        setErrorMsg("Errore caricamento maestro selezionato.\n" + msg);
        return;
      }

      setSelectedInstructor(json.data);
    } catch (err) {
      console.error("Errore loadInstructor:", err);
      setErrorMsg("Errore rete nel caricamento maestro.");
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    resetFeedback();

    if (!selectedInstructor) {
      alert("Seleziona prima un maestro");
      return;
    }

    const payload = {
      conversation_id: getConversationId() || null,
      instructor_id: selectedInstructor.id,
      calendar_id: selectedInstructor.calendar_id,
      instructor_name: selectedInstructor.name || null,
      name: safeText(customerName),
      phone: safeText(phone),
      message: safeText(message),
      client_tz:
        typeof Intl !== "undefined"
          ? Intl.DateTimeFormat().resolvedOptions().timeZone
          : "Europe/Rome",
      source: "landing",
    };

    setLastBasePayload(payload);
    setChatMissingFields([]);
    setChatDraftFields({});
    await callMakeEndpoint(payload);
  }

  async function callMakeEndpoint(payload) {
    setSending(true);
    try {
      const res = await fetch(MAKE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const contentType = res.headers.get("content-type") || "";
      let data;
      if (contentType.includes("application/json")) data = await res.json();
      else data = { ok: res.ok, message: await res.text() };

      if (data && data.conversation_id) {
        setConversationId(data.conversation_id);
      }

      if (!res.ok) {
        setErrorMsg(normalizeMessage(data?.message) || "Errore nell'invio.");
        setSending(false);
        return;
      }

      const normalizedMsg = normalizeMessage(data?.message);

      if (data?.status === "ask_info") {
        setAltVisible(true);
        setAltMsg(normalizedMsg);
        setSending(false);
        return;
      }

      if (data?.status === "need_more_info") {
        const mf = Array.isArray(data?.missing_fields) ? data.missing_fields : [];
        openChat(normalizedMsg, mf);
        setSending(false);
        return;
      }

      if (data?.status === "slot_busy") {
        const alts = Array.isArray(data?.alternatives) ? data.alternatives : [];
        renderAlternatives(normalizedMsg, alts);
        setSending(false);
        return;
      }

      if (data?.ok === true) {
        setSuccessMsg(normalizedMsg || "Richiesta inviata con successo.");
        setSending(false);
        return;
      }

      setAltVisible(true);
      setAltMsg(normalizedMsg);
      setSending(false);
    } catch (err) {
      console.error("Errore fetch verso Make:", err);
      setErrorMsg("Errore rete.");
      setSending(false);
    }
  }

  function renderAlternatives(message, alternatives) {
    setAltVisible(true);
    setAltMsg(
      message || "Quello slot è già occupato. Ti propongo alcune alternative:"
    );
    const firstTwo = (alternatives || []).slice(0, 2);
    setAltAlternatives(firstTwo);

    if (firstTwo.length === 0) {
      setAltMsg(
        "Mi dispiace, ma non ho alternative immediate. Puoi indicarmi un altro orario?"
      );
    }
  }

  async function confirmBooking(payload) {
    if (!MAKE_CONFIRM_WEBHOOK_URL || MAKE_CONFIRM_WEBHOOK_URL.includes("PASTE_")) {
      setErrorMsg("Manca MAKE_CONFIRM_WEBHOOK_URL. Incolla l'URL del webhook di conferma.");
      return;
    }

    try {
      const res = await fetch(MAKE_CONFIRM_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const contentType = res.headers.get("content-type") || "";
      let data;
      if (contentType.includes("application/json")) data = await res.json();
      else data = { ok: res.ok, message: await res.text() };

      if (!res.ok) {
        setErrorMsg(normalizeMessage(data?.message) || "Errore nella conferma.");
        return;
      }

      const msg = normalizeMessage(data?.message) || "Booking confermato.";
      setAltVisible(true);
      setAltMsg(msg);

      const ref = safeText(data?.booking_ref || data?.reference || "");
      const st = safeText(data?.start_time || payload?.chosen_start_time || "");
      const en = safeText(data?.end_time || payload?.chosen_end_time || "");
      const inst = safeText(data?.instructor_name || payload?.instructor_name || "");

      const lines = [];
      if (inst) lines.push(`Maestro: ${inst}`);
      if (st && en) lines.push(`Orario: ${formatSlot(st, en)}`);
      if (ref) lines.push(`Riferimento: ${ref}`);
      setAltMeta(lines.join(" | "));
    } catch (err) {
      console.error("Errore confirmBooking:", err);
      setErrorMsg("Errore rete nella conferma.");
    }
  }

  // === mini chat ===
  function openChat(initialAiMessage, missingFields) {
    setChatMissingFields(Array.isArray(missingFields) ? missingFields : []);
    setChatMessages([
      {
        role: "ai",
        text: initialAiMessage || "Dimmi pure i dettagli mancanti.",
      },
    ]);
    setChatOpen(true);
    setTimeout(scrollChatToBottom, 50);
  }

  function closeChat() {
    setChatOpen(false);
  }

  function addChatMsg(role, text) {
    setChatMessages((prev) => [...prev, { role, text }]);
    setTimeout(scrollChatToBottom, 50);
  }

  function scrollChatToBottom() {
    if (!chatBodyRef.current) return;
    chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
  }

  async function onChatSend() {
    const userText = safeText(chatText).trim();
    if (!userText) return;

    if (!MAKE_CHAT_WEBHOOK_URL || MAKE_CHAT_WEBHOOK_URL.includes("PASTE_")) {
      addChatMsg(
        "ai",
        "Manca MAKE_CHAT_WEBHOOK_URL. Incolla l'URL del webhook mini chat."
      );
      return;
    }

    addChatMsg("user", userText);
    setChatText("");
    setChatSending(true);

    try {
      const payload = {
        session_id: chatSessionId,
        conversation_id: getConversationId() || null,
        instructor_id: lastBasePayload?.instructor_id || null,
        instructor_name: lastBasePayload?.instructor_name || null,
        calendar_id: lastBasePayload?.calendar_id || null,
        customer_name: lastBasePayload?.name || null,
        customer_phone: lastBasePayload?.phone || null,
        original_message: lastBasePayload?.message || null,
        missing_fields: chatMissingFields,
        user_message: userText,
        client_tz:
          lastBasePayload?.client_tz ||
          (typeof Intl !== "undefined"
            ? Intl.DateTimeFormat().resolvedOptions().timeZone
            : "Europe/Rome"),
        source: "landing_chat",
      };

      const res = await fetch(MAKE_CHAT_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const contentType = res.headers.get("content-type") || "";
      let data;
      if (contentType.includes("application/json")) data = await res.json();
      else data = { ok: res.ok, message: await res.text() };

      if (!res.ok) {
        addChatMsg(
          "ai",
          normalizeMessage(data?.message) || "Errore nella chat."
        );
        setChatSending(false);
        return;
      }

      addChatMsg("ai", normalizeMessage(data?.message));

      if (Array.isArray(data?.missing_fields)) {
        const mf = data.missing_fields;
        setChatMissingFields(mf);
      }

      if (data?.is_complete === true) {
        const uf =
          data?.updated_fields && typeof data.updated_fields === "object"
            ? data.updated_fields
            : {};
        setChatDraftFields((prev) => ({ ...prev, ...uf }));

        setTimeout(async () => {
          closeChat();
          const merged = {
            ...lastBasePayload,
            ...uf,
            message: lastBasePayload?.message || "",
          };
          await callMakeEndpoint(merged);
        }, 300);
      }

      setChatSending(false);
    } catch (err) {
      console.error("Errore mini chat:", err);
      addChatMsg("ai", "Errore rete. Riprova tra pochi secondi.");
      setChatSending(false);
    }
  }

  // meta per la chat
  const chatMetaText =
    chatMissingFields.length > 0
      ? "Mi servono: " + chatMissingFields.join(", ")
      : "Rispondi qui con i dettagli.";

  return (
    <>
      <Head>
        <title>FrostDesk Booking</title>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>{`
          body {
            margin: 0;
            padding: 0;
            background-color: #0e0f12;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            color: #e5e7eb;
          }
          .container {
            max-width: 560px;
            margin: 0 auto;
            padding: 32px;
            background: #1a1d22;
            margin-top: 48px;
            border-radius: 24px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
            animation: fadeIn 0.6s ease;
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
          h1 {
            text-align: center;
            font-size: 32px;
            font-weight: 700;
            margin-bottom: 10px;
            color: #ffffff;
            letter-spacing: -0.5px;
          }
          p.subtitle {
            text-align: center;
            color: #9ca3af;
            margin-bottom: 32px;
            font-size: 15px;
          }
          label {
            font-weight: 600;
            display: block;
            margin-top: 16px;
            margin-bottom: 6px;
            color: #c7c7c7;
          }
          select, input, textarea {
            width: 100%;
            padding: 14px;
            font-size: 16px;
            background: #24272e;
            border: 1px solid #3d414a;
            border-radius: 12px;
            color: white;
            transition: 0.2s ease;
            box-sizing: border-box;
          }
          select:focus, input:focus, textarea:focus {
            border-color: #3b82f6;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.3);
            outline: none;
          }
          textarea { height: 120px; }
          .button {
            width: 100%;
            padding: 16px;
            margin-top: 20px;
            background-color: #3b82f6;
            color: white;
            font-size: 18px;
            border: none;
            border-radius: 14px;
            cursor: pointer;
            font-weight: 600;
            transition: 0.25s ease;
          }
          .button:hover {
            background-color: #2563eb;
            transform: translateY(-1px);
          }
          .button.secondary {
            background-color: #111318;
            border: 1px solid #3d414a;
            font-size: 16px;
            margin-top: 10px;
          }
          .button.secondary:hover {
            background-color: #171a22;
            transform: translateY(-1px);
          }
          .card {
            margin-top: 24px;
            padding: 20px;
            background: #24272e;
            border-radius: 16px;
            border: 1px solid #2f333a;
            animation: fadeIn 0.4s ease;
          }
          .card img {
            width: 140px;
            height: 140px;
            border-radius: 16px;
            object-fit: cover;
            margin-bottom: 14px;
            background: #0e0f12;
          }
          #chatOverlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.6);
            backdrop-filter: blur(2px);
            z-index: 1000;
            align-items: center;
            justify-content: center;
            padding: 18px;
            box-sizing: border-box;
            display: none;
          }
          #chatOverlay.open {
            display: flex;
          }
          #chatModal {
            width: 100%;
            max-width: 560px;
            background: #111318;
            border: 1px solid #2f333a;
            border-radius: 18px;
            box-shadow: 0 12px 40px rgba(0,0,0,0.55);
            overflow: hidden;
          }
          #chatHeader {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 16px;
            border-bottom: 1px solid #2f333a;
            background: #0e0f12;
          }
          #chatHeaderTitle {
            font-weight: 700;
            font-size: 14px;
            color: #e5e7eb;
          }
          #chatClose {
            background: transparent;
            border: 1px solid #2f333a;
            color: #e5e7eb;
            border-radius: 10px;
            padding: 8px 10px;
            cursor: pointer;
            font-size: 12px;
          }
          #chatClose:hover {
            background: #171a22;
          }
          #chatBody {
            padding: 14px 16px;
            height: 320px;
            overflow-y: auto;
            background: #111318;
          }
          .chatMsg {
            padding: 10px 12px;
            border-radius: 14px;
            margin-bottom: 10px;
            line-height: 1.35;
            font-size: 14px;
            border: 1px solid #2f333a;
            white-space: pre-wrap;
            word-break: break-word;
          }
          .chatMsg.ai {
            background: #0e0f12;
            color: #e5e7eb;
          }
          .chatMsg.user {
            background: #1a1d22;
            color: #ffffff;
            border-color: #3d414a;
          }
          #chatFooter {
            display: flex;
            gap: 10px;
            padding: 12px 12px;
            border-top: 1px solid #2f333a;
            background: #0e0f12;
            box-sizing: border-box;
          }
        `}</style>
      </Head>

      <div className="container">
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <img
            src="/frostdesk-logo.svg"
            alt="FrostDesk"
            style={{
              width: 72,
              height: 72,
              borderRadius: "20px",
              objectFit: "contain",
              background: "#0e0f12"
            }}
          />
        </div>

        <h1>FrostDesk</h1>

        <p className="subtitle">
          Scrivi direttamente al tuo maestro e controlla la sua agenda
        </p>

        <label>Seleziona il maestro</label>
        <select
          value={selectedInstructorId}
          onChange={handleSelectChange}
          disabled={instructorsLoading}
        >
          {instructorsLoading && <option>Caricamento maestri...</option>}
          {!instructorsLoading && instructors.length === 0 && (
            <option>Nessun maestro disponibile</option>
          )}
          {!instructorsLoading && instructors.length > 0 && (
            <>
              <option value="">Scegli un maestro</option>
              {instructors.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {inst.name || "Maestro"}
                </option>
              ))}
            </>
          )}
        </select>

        {selectedInstructor && (
          <div className="card">
            <img id="photo" src={selectedInstructor.photo_url || ""} alt="Foto maestro" />
            <h2 id="name">{selectedInstructor.name || ""}</h2>
            <p id="bio">{selectedInstructor.bio || ""}</p>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <label>Nome</label>
          <input
            placeholder="Il tuo nome"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
          />

          <label>Telefono</label>
          <input
            placeholder="+39..."
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />

          <label>Messaggio</label>
          <textarea
            placeholder="Scrivi qui la tua richiesta"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />

          <button className="button" type="submit" disabled={sending}>
            {sending ? "Invio in corso..." : "Invia richiesta"}
          </button>
        </form>

        {successMsg && <p id="success">{successMsg}</p>}
        {errorMsg && <p id="errorMsg">{errorMsg}</p>}

        {altVisible && (
          <div id="altBox" className="card">
            <h3 style={{ margin: "0 0 10px 0" }}>Risposta</h3>
            <p
              id="altMsg"
              style={{ color: "#e5e7eb", fontSize: 14, margin: 0 }}
            >
              {altMsg}
            </p>
            <div id="altList" style={{ marginTop: 12 }}>
              {altAlternatives.map((a, i) => (
                <button
                  key={i}
                  type="button"
                  className="button secondary"
                  onClick={async () => {
                    resetFeedback();
                    setAltVisible(true);
                    setAltMsg("Perfetto, sto confermando questa alternativa...");
                    setAltAlternatives([]);
                    await confirmBooking({
                      ...lastBasePayload,
                      chosen_start_time: a?.start_time || null,
                      chosen_end_time: a?.end_time || null,
                    });
                  }}
                >
                  {formatSlot(a.start_time, a.end_time)}
                </button>
              ))}
            </div>
            <div className="smallMuted">{altMeta}</div>
          </div>
        )}
      </div>

      {/* MINI CHAT MODAL */}
      <div id="chatOverlay" className={chatOpen ? "open" : ""}>
        <div id="chatModal">
          <div id="chatHeader">
            <div id="chatHeaderTitle">Completiamo la richiesta</div>
            <button id="chatClose" type="button" onClick={closeChat}>
              Chiudi
            </button>
          </div>

          <div id="chatBody" ref={chatBodyRef}>
            {chatMessages.map((m, i) => (
              <div key={i} className={`chatMsg ${m.role === "user" ? "user" : "ai"}`}>
                {m.text}
              </div>
            ))}
          </div>
          <div id="chatMeta">{chatMetaText}</div>

          <div id="chatFooter">
            <input
              id="chatInput"
              placeholder="Scrivi qui..."
              autoComplete="off"
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onChatSend();
                }
              }}
            />
            <button
              id="chatSend"
              type="button"
              disabled={chatSending}
              onClick={onChatSend}
            >
              {chatSending ? "..." : "Invia"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
