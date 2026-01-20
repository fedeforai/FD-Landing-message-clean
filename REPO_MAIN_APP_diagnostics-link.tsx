// File: app/conversations/[id]/page.tsx
// Repo: Main App
// ADD: Link to diagnostics page in conversation detail view

// ... existing code ...

// Add this link somewhere in your conversation detail page (e.g., in header or actions section)
<Link
  href={`/conversations/${conversationId}/diagnostics`}
  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-800 border border-blue-300 rounded-lg hover:bg-blue-50 transition-colors"
>
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
  View Diagnostics
</Link>

// ... existing code ...
