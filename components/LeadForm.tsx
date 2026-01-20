// components/LeadForm.tsx
// Lead capture form component

"use client";

import { useState, useRef } from "react";

interface LeadFormProps {
  instructorId?: string;
  instructorSlug?: string;
  onSubmit?: (result: { ok: boolean; trace_id?: string }) => void;
}

export default function LeadForm({ instructorId, instructorSlug, onSubmit }: LeadFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Anti-spam: Honeypot field (hidden from users)
  const honeypotRef = useRef<HTMLInputElement>(null);
  const formRenderTimeRef = useRef(Date.now());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    // Anti-spam: Check honeypot
    if (honeypotRef.current?.value) {
      // Bot detected, silently ignore
      return;
    }

    // Anti-spam: Check minimum submit time
    const timeSinceRender = Date.now() - formRenderTimeRef.current;
    if (timeSinceRender < 2000) {
      // Submit too fast, silently ignore
      return;
    }

    if (!name.trim() || !email.trim() || !message.trim()) {
      setError("Please fill in all fields");
      return;
    }

    if (!instructorId && !instructorSlug) {
      setError("Instructor not selected");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/ingest-lead", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          message: message.trim(),
          instructor_id: instructorId,
          instructor_slug: instructorSlug,
          channel: "webchat",
          honeypot: honeypotRef.current?.value || "",
          submit_time: formRenderTimeRef.current,
        }),
      });

      const data = await response.json();

      if (data.ok) {
        setSuccess(true);
        setName("");
        setEmail("");
        setMessage("");
        if (onSubmit) {
          onSubmit({ ok: true, trace_id: data.trace_id });
        }
      } else {
        setError(data.error || "Failed to send message. Please try again.");
        if (onSubmit) {
          onSubmit({ ok: false, trace_id: data.trace_id });
        }
      }
    } catch (err) {
      setError("Network error. Please check your connection and try again.");
      if (onSubmit) {
        onSubmit({ ok: false });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="lead-form">
      {/* Honeypot field - hidden from users, bots will fill it */}
      <input
        type="text"
        name="website"
        ref={honeypotRef}
        tabIndex={-1}
        autoComplete="off"
        style={{
          position: "absolute",
          left: "-9999px",
          opacity: 0,
          pointerEvents: "none",
        }}
        aria-hidden="true"
      />

      <div className="form-group">
        <label htmlFor="lead-name">Name *</label>
        <input
          id="lead-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          disabled={submitting}
          maxLength={255}
        />
      </div>

      <div className="form-group">
        <label htmlFor="lead-email">Email *</label>
        <input
          id="lead-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={submitting}
          maxLength={255}
        />
      </div>

      <div className="form-group">
        <label htmlFor="lead-message">Message *</label>
        <textarea
          id="lead-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          disabled={submitting}
          maxLength={5000}
          rows={5}
        />
      </div>

      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}

      {success && (
        <div className="form-success" role="alert">
          Thank you! Your message has been sent. We'll get back to you soon.
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || !name.trim() || !email.trim() || !message.trim()}
        className="submit-button"
      >
        {submitting ? "Sending..." : "Send Message"}
      </button>
    </form>
  );
}
