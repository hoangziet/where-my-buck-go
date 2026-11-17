"use client";

import { useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import type { TransactionDto } from "@/lib/api";
import { useEscapeKey } from "@/lib/use-escape-key";

export function EvidenceImage({ id }: { id: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative rounded-[10px] overflow-hidden border border-border-input bg-[#F4F2EC] min-h-[160px] flex items-center justify-center">
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted animate-pulse">
          Loading receipt image…
        </div>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/evidence/${id}`}
        alt="Original receipt"
        onLoad={() => setLoaded(true)}
        className={`w-full h-auto rounded-[10px] object-contain transition-opacity duration-200 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
        loading="eager"
      />
    </div>
  );
}

export function EvidenceModal({ transaction, onClose }: { transaction: TransactionDto; onClose: () => void }) {
  const initialKnown = useMemo(() => {
    if (transaction.evidence) {
      return transaction.evidence.map((e) => ({ id: e.id, kind: e.kind, text: undefined as string | undefined }));
    }
    if (transaction.evidenceIds && transaction.evidenceIds.length === 0) {
      return [];
    }
    return null;
  }, [transaction]);

  const [items, setItems] = useState<{ id: string; kind: "text" | "image"; text?: string }[] | null>(initialKnown);
  const [error, setError] = useState<string | null>(null);
  useEscapeKey(onClose);

  useEffect(() => {
    let cancelled = false;

    if (transaction.evidence) {
      const needsText = transaction.evidence.some((e) => e.kind === "text");
      if (!needsText) return;
      Promise.all(
        transaction.evidence.map(async (e) => {
          if (e.kind === "image") return { id: e.id, kind: "image" as const };
          const loaded = await api.getEvidence(e.id);
          return { id: e.id, kind: "text" as const, text: loaded.content };
        }),
      )
        .then((loaded) => {
          if (!cancelled) setItems(loaded);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : "Could not load evidence");
        });
      return;
    }

    if (transaction.evidenceIds && transaction.evidenceIds.length === 0) {
      return;
    }

    api
      .getTransaction(transaction.id)
      .then(async (detail) => {
        if (detail.evidence && detail.evidence.length > 0) {
          return Promise.all(
            detail.evidence.map(async (e) => {
              if (e.kind === "image") return { id: e.id, kind: "image" as const };
              const loaded = await api.getEvidence(e.id);
              return { id: e.id, kind: "text" as const, text: loaded.content };
            }),
          );
        }
        return Promise.all(
          detail.evidenceIds.map(async (id) => {
            const loaded = await api.getEvidence(id);
            return { id, kind: loaded.kind, text: loaded.kind === "text" ? loaded.content : undefined };
          }),
        );
      })
      .then((loaded) => {
        if (!cancelled) setItems(loaded);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load evidence");
      });

    return () => {
      cancelled = true;
    };
  }, [transaction]);

  return (
    <div className="fixed inset-0 bg-ink/40 z-30 flex items-center justify-center px-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-3.5 w-full max-w-[480px] max-h-[80vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h2 className="m-0 text-base font-semibold">Original evidence</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-ink-3 border-0 bg-transparent cursor-pointer transition-colors duration-150 hover:bg-[#F4F2EC] hover:text-ink"
          >
            ✕
          </button>
        </div>
        <p className="m-0 text-xs text-muted">
          What was originally submitted for &ldquo;{transaction.description}&rdquo;, read-only.
        </p>
        {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
        {!error && items === null && <p className="m-0 text-sm text-muted">Loading…</p>}
        {items?.length === 0 && <p className="m-0 text-sm text-muted">No evidence on file.</p>}
        {items?.map(({ id, kind, text }) =>
          kind === "image" ? (
            <EvidenceImage key={id} id={id} />
          ) : (
            <pre
              key={id}
              className="m-0 bg-[#F6F5F0] border border-border-row rounded-[10px] px-3.5 py-3 text-sm whitespace-pre-wrap break-words font-sans"
            >
              {text ?? "Loading text…"}
            </pre>
          ),
        )}
      </div>
    </div>
  );
}
