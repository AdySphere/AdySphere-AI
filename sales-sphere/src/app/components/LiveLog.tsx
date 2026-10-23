"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Log = { id: string; level: string; message: string; createdAt: string };
const ACTIVE = new Set(["created", "discovering", "enriching", "writing"]);

export function LiveLog({ campaignId, initial, initialStatus }: { campaignId: string; initial: Log[]; initialStatus: string }) {
  const [logs, setLogs] = useState(initial);
  const [status, setStatus] = useState(initialStatus);
  const box = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    let stop = false;
    let last = initial.at(-1)?.createdAt;
    let lastStatus = initialStatus;
    const tick = async () => {
      if (stop) return;
      const res = await fetch(`/api/campaigns/${campaignId}/log${last ? `?after=${encodeURIComponent(last)}` : ""}`).catch(() => null);
      if (res?.ok) {
        const data = (await res.json()) as { campaign: { status: string }; logs: Log[] };
        if (data.logs.length) {
          last = data.logs.at(-1)!.createdAt;
          setLogs((l) => [...l, ...data.logs]);
        }
        if (data.campaign.status !== lastStatus) {
          lastStatus = data.campaign.status;
          setStatus(lastStatus);
          router.refresh();
        }
      }
      setTimeout(tick, ACTIVE.has(lastStatus) ? 2000 : 10000);
    };
    const t = setTimeout(tick, 1500);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [campaignId, initial, initialStatus, router]);

  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [logs]);

  return (
    <>
      <p>Status: <span className="pill">{status.replace(/_/g, " ")}</span> {ACTIVE.has(status) && <span className="muted">running…</span>}</p>
      <div className="log" ref={box}>
        {logs.map((l) => (
          <div key={l.id} className={l.level}>
            {new Date(l.createdAt).toLocaleTimeString()} {l.message}
          </div>
        ))}
        {logs.length === 0 && <div className="muted">Starting…</div>}
      </div>
    </>
  );
}
