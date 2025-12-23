/* pages/index.js */
import { useEffect, useRef, useState } from "react";
import Head from "next/head";

const INSTRUCTORS_API_URL = "/api/instructors";
const MAKE_WEBHOOK_URL = "https://hook.eu1.make.com/dgt5e15smwx72qyn9dnfwlqwxu89xdak";
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

function getClientTZ() {
  return typeof Intl !== "undefined"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : "Europe/Rome";
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

  // mini-chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatText, setChatText] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatMissingFields, setChatMissingFields] = useState([]);
  const [chatDraftFields, setChatDraftFields] = useState({});
  const [chatSessionId, setChatSessionIdState] = useState(null);

  const [lastBasePayload, setLastBasePayload] = useState(null);

  // debug leggero per capire Make
  const [debug, setDebug] = useState(null);

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
    setDebug(null);
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

  function applyChip(text) {
    const add = String(text || "").trim();
    if (!add) return;
    setMessage((prev) => {
      const p = safeText(prev).trim();
      if (!p) return add;
      if (p.endsWith("\n")) return p + add;
      return p + "\n" + add;
    });
  }

  function applyMessageTemplate() {
    const template = "Domani 10:00, 2 ore, 2 persone, intermedio, Meeting Point Mottolino";
    setMessage((prev) => {
      const p = safeText(prev).trim();
      return p ? p : template;
    });
  }

  // heuristics super light per checklist
  function guessChecklist(msg) {
    const m = safeText(msg).toLowerCase();
    const hasPeople = /\b(\d+)\s*(persone|people|pax)\b/.test(m) || /\b(1|2|3|4|5)\b/.test(m);
    const hasLevel = /\b(principiante|beginner|intermedio|intermediate|avanzato|advanced)\b/.test(m);
    const hasDuration = /\b(\d+)\s*(h|hr|hrs|ore|hours|min|mins|minuti)\b/.test(m) || /\b(1h|2h|3h)\b/.test(m);
    const hasTime = /\b\d{1,2}[:.]\d{2}\b/.test(m) || /\b(mattina|pomeriggio|morning|afternoon)\b/.test(m);
    const hasDate = /\b(oggi|domani|sabato|domenica|lunedì|martedì|mercoledì|giovedì|venerdì|today|tomorrow|sat|sun|mon|tue|wed|thu|fri|next)\b/.test(m) || /\b\d{1,2}\/\d{1,2}\b/.test(m);
    const hasLocation = /\b(meeting point|meeting|mottolino|carosello|centro|hotel|lift|funivia|piazza)\b/.test(m);

    return {
      dateTime: hasDate && hasTime,
      duration: hasDuration,
      location: hasLocation,
      level: hasLevel,
      participants: hasPeople,
    };
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
      client_tz: getClientTZ(),
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

      // debug minimo utile
      setDebug({
        ok: !!data?.ok,
        status: data?.status || null,
        missing_fields: Array.isArray(data?.missing_fields) ? data.missing_fields : null,
      });

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
    setAltMsg(message || "Quello slot è già occupato. Ti propongo alcune alternative:");
    const firstTwo = (alternatives || []).slice(0, 2);
    setAltAlternatives(firstTwo);

    if (firstTwo.length === 0) {
      setAltMsg("Mi dispiace, ma non ho alternative immediate. Puoi indicarmi un altro orario?");
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
      { role: "ai", text: initialAiMessage || "Dimmi pure i dettagli mancanti." },
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
      addChatMsg("ai", "Manca MAKE_CHAT_WEBHOOK_URL. Incolla l'URL del webhook mini chat.");
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
        client_tz: lastBasePayload?.client_tz || getClientTZ(),
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
        addChatMsg("ai", normalizeMessage(data?.message) || "Errore nella chat.");
        setChatSending(false);
        return;
      }

      addChatMsg("ai", normalizeMessage(data?.message));

      if (Array.isArray(data?.missing_fields)) {
        setChatMissingFields(data.missing_fields);
      }

      if (data?.is_complete === true) {
        const uf = data?.updated_fields && typeof data.updated_fields === "object"
          ? data.updated_fields
          : {};
        setChatDraftFields((prev) => ({ ...prev, ...uf }));

        setTimeout(async () => {
          closeChat();
          const merged = { ...lastBasePayload, ...uf, message: lastBasePayload?.message || "" };
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

  const checklist = guessChecklist(message);

  return (
    <>
      <Head>
        <title>FrostDesk Booking</title>
        <meta name="description" content="Prenota una lezione di sci in 30 secondi. FrostDesk controlla l’agenda del maestro e gestisce la richiesta." />
        <meta name="author" content="FrostDesk" />
        <meta property="og:title" content="FrostDesk Booking" />
        <meta property="og:description" content="Scrivi al maestro. FrostDesk controlla l’agenda e ti propone subito lo slot giusto." />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="/og-image.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content="/og-image.png" />
        <link rel="icon" href="/favicon.ico" />
        <style>{`
          body {
            margin: 0;
            padding: 0;
            background: radial-gradient(1200px 600px at 20% 0%, rgba(59,130,246,0.18), transparent 60%),
                        radial-gradient(900px 500px at 90% 10%, rgba(99,102,241,0.14), transparent 55%),
                        radial-gradient(900px 500px at 50% 100%, rgba(16,185,129,0.08), transparent 60%),
                        #0b0c0f;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            color: #e5e7eb;
          }
          .container {
            max-width: 560px;
            margin: 0 auto;
            padding: 34px;
            background: rgba(17, 19, 24, 0.78);
            margin-top: 56px;
            border-radius: 26px;
            border: 1px solid rgba(255, 255, 255, 0.07);
            box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            animation: fadeIn 0.6s ease;
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
          h1 {
            text-align: center;
            font-size: 34px;
            font-weight: 800;
            margin-bottom: 10px;
            color: #ffffff;
            letter-spacing: -0.5px;
            text-shadow: 0 8px 30px rgba(0,0,0,0.35);
          }
          p.subtitle {
            text-align: center;
            color: #9ca3af;
            margin-bottom: 22px;
            font-size: 15px;
          }
          .hint {
            margin: 10px 0 18px 0;
            padding: 12px;
            border-radius: 14px;
            border: 1px solid #2f333a;
            background: linear-gradient(180deg, rgba(14,15,18,0.75), rgba(14,15,18,0.45));
            color: #cbd5e1;
            font-size: 13px;
            line-height: 1.35;
          }
          .fieldHelp {
            margin-top: 10px;
            padding: 12px;
            border-radius: 14px;
            border: 1px solid #2f333a;
            background: #0e0f12;
            color: #cbd5e1;
            font-size: 13px;
            line-height: 1.35;
          }
          .fieldHelpTop {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            margin-bottom: 8px;
          }
          .fieldHelpTitle {
            font-weight: 700;
            color: #e5e7eb;
            font-size: 13px;
          }
          .miniBtn {
            border: 1px solid #2f333a;
            background: #111318;
            color: #e5e7eb;
            border-radius: 999px;
            padding: 8px 10px;
            font-size: 12px;
            cursor: pointer;
            transition: 0.2s ease;
            white-space: nowrap;
          }
          .miniBtn:hover {
            background: #171a22;
            transform: translateY(-1px);
          }
          .exampleBox {
            margin-top: 8px;
            border-radius: 12px;
            border: 1px solid #2f333a;
            background: #111318;
            padding: 10px 12px;
            color: #e5e7eb;
            font-size: 13px;
          }
          .chips {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 10px;
          }
          .chip {
            cursor: pointer;
            border: 1px solid #2f333a;
            background: #0e0f12;
            color: #e5e7eb;
            border-radius: 999px;
            padding: 8px 10px;
            font-size: 12px;
            transition: 0.2s ease;
          }
          .chip:hover {
            background: #171a22;
            transform: translateY(-1px);
          }
          .checklist {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            margin-top: 10px;
          }
          .checkItem {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 12px;
            border-radius: 14px;
            border: 1px solid #2f333a;
            background: #111318;
            font-size: 12px;
            color: #cbd5e1;
          }
          .dot {
            width: 10px;
            height: 10px;
            border-radius: 999px;
            background: #374151;
          }
          .dot.ok { background: #22c55e; }
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
            font-weight: 700;
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
          .smallMuted {
            margin-top: 10px;
            font-size: 12px;
            color: #9ca3af;
          }
          #success { color: #22c55e; margin-top: 18px; white-space: pre-wrap; }
          #errorMsg { color: #f87171; margin-top: 18px; white-space: pre-wrap; }
          .debug {
            margin-top: 12px;
            font-size: 12px;
            color: #9ca3af;
            background: #111318;
            border: 1px solid #2f333a;
            border-radius: 14px;
            padding: 10px 12px;
            white-space: pre-wrap;
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
          #chatOverlay.open { display: flex; }
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
          #chatHeaderTitle { font-weight: 800; font-size: 14px; color: #e5e7eb; }
          #chatClose {
            background: transparent;
            border: 1px solid #2f333a;
            color: #e5e7eb;
            border-radius: 10px;
            padding: 8px 10px;
            cursor: pointer;
            font-size: 12px;
          }
          #chatClose:hover { background: #171a22; }
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
          .chatMsg.ai { background: #0e0f12; color: #e5e7eb; }
          .chatMsg.user { background: #1a1d22; color: #ffffff; border-color: #3d414a; }
          #chatMeta {
            padding: 10px 16px;
            border-top: 1px solid #2f333a;
            background: #0e0f12;
            font-size: 12px;
            color: #9ca3af;
          }
          #chatFooter {
            display: flex;
            gap: 10px;
            padding: 12px 12px;
            border-top: 1px solid #2f333a;
            background: #0e0f12;
            box-sizing: border-box;
          }
          #chatInput {
            flex: 1;
            padding: 12px;
            font-size: 14px;
            background: #24272e;
            border: 1px solid #3d414a;
            border-radius: 12px;
            color: white;
          }
          #chatSend {
            padding: 12px 14px;
            font-size: 14px;
            background: #3b82f6;
            border: none;
            border-radius: 12px;
            color: white;
            cursor: pointer;
            font-weight: 700;
          }
          #chatSend:disabled { opacity: 0.7; cursor: default; }
        `}</style>
      </Head>

      <div className="container">
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <img
            src="/frostdesk-logo1.svg"
            alt="FrostDesk"
            style={{
              width: 72,
              height: 72,
              borderRadius: "20px",
              objectFit: "contain",
              background: "#0e0f12"
            }}
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        </div>

        <h1>FrostDesk</h1>

        <p className="subtitle">
          Invia una richiesta al maestro. FrostDesk controlla l’agenda e ti risponde subito.
        </p>

        <div className="hint">
          Suggerimento: scrivi così per essere confermato più velocemente.
          <div style={{ marginTop: 8, color: "#e5e7eb" }}>
            “Domani 10:00, 2 ore, 2 persone, intermedio, Meeting Point Mottolino”
          </div>
          <div className="chips">
            <button type="button" className="chip" onClick={() => applyChip("Oggi")}>Oggi</button>
            <button type="button" className="chip" onClick={() => applyChip("Domani")}>Domani</button>
            <button type="button" className="chip" onClick={() => applyChip("10:00")}>10:00</button>
            <button type="button" className="chip" onClick={() => applyChip("2 ore")}>2 ore</button>
            <button type="button" className="chip" onClick={() => applyChip("2 persone")}>2 persone</button>
            <button type="button" className="chip" onClick={() => applyChip("Principiante")}>Principiante</button>
            <button type="button" className="chip" onClick={() => applyChip("Intermedio")}>Intermedio</button>
            <button type="button" className="chip" onClick={() => applyChip("Avanzato")}>Avanzato</button>
            <button type="button" className="chip" onClick={() => applyChip("Meeting point:")}>Meeting point:</button>
          </div>

          <div className="checklist">
            <div className="checkItem"><span className={`dot ${checklist.dateTime ? "ok" : ""}`} /> Data e ora</div>
            <div className="checkItem"><span className={`dot ${checklist.duration ? "ok" : ""}`} /> Durata</div>
            <div className="checkItem"><span className={`dot ${checklist.participants ? "ok" : ""}`} /> Persone</div>
            <div className="checkItem"><span className={`dot ${checklist.level ? "ok" : ""}`} /> Livello</div>
            <div className="checkItem" style={{ gridColumn: "1 / -1" }}><span className={`dot ${checklist.location ? "ok" : ""}`} /> Location / Meeting point</div>
          </div>
        </div>

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
            <h2 id="name" style={{ margin: "0 0 8px 0" }}>{selectedInstructor.name || ""}</h2>
            <p id="bio" style={{ margin: 0, color: "#cbd5e1" }}>{selectedInstructor.bio || ""}</p>
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
          <div className="fieldHelp">
            <div className="fieldHelpTop">
              <div className="fieldHelpTitle">Come scrivere il messaggio</div>
              <button type="button" className="miniBtn" onClick={applyMessageTemplate}>
                Inserisci esempio
              </button>
            </div>
            <div>Include sempre: data e ora, durata, numero persone, livello, meeting point.</div>
            <div className="exampleBox">
              Domani 10:00, 2 ore, 2 persone, intermedio, Meeting Point Mottolino
            </div>
          </div>

          <textarea
            placeholder="Scrivi qui, seguendo l’esempio sopra"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />

          <button className="button" type="submit" disabled={sending}>
            {sending ? "Invio in corso..." : "Invia richiesta"}
          </button>
        </form>

        {successMsg && <p id="success">{successMsg}</p>}
        {errorMsg && <p id="errorMsg">{errorMsg}</p>}

        {debug && (
          <div className="debug">
            Debug: {JSON.stringify(debug, null, 2)}
          </div>
        )}

        {altVisible && (
          <div id="altBox" className="card">
            <h3 style={{ margin: "0 0 10px 0" }}>Risposta</h3>
            <p id="altMsg" style={{ color: "#e5e7eb", fontSize: 14, margin: 0 }}>
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

            {altMeta ? <div className="smallMuted">{altMeta}</div> : null}
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
