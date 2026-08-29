import { useEffect, useRef, useState } from "react";
import type { Message } from "../model";

const EMAIL_DOCUMENT_START = `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'">
<base target="_blank">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #181818; }
  body, table, td, th, button, input { font-family: Inter, Arial, sans-serif !important; font-size: 14px; line-height: 1.55; }
  body { overflow-wrap: anywhere; }
  img { max-width: 100% !important; height: auto !important; }
  table { max-width: 100% !important; border-collapse: collapse; }
  pre { max-width: 100%; overflow: auto; white-space: pre-wrap; }
  blockquote { margin: 12px 0; padding-left: 12px; border-left: 2px solid #d0d0d0; color: #666; }
  a { color: #181818; text-decoration: underline; }
  p:first-child { margin-top: 0; }
  p:last-child { margin-bottom: 0; }
</style></head><body>`;
const EMAIL_DOCUMENT_END = "</body></html>";

type EmailBodyProps = {
  message: Message;
};

export function EmailBody({ message }: EmailBodyProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [height, setHeight] = useState(80);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  if (message.htmlBody === null) {
    return <div className="message-card__body">{message.body}</div>;
  }

  const handleLoad = () => {
    const body = iframeRef.current?.contentDocument?.body;
    if (body === null || body === undefined) return;
    const updateHeight = () => setHeight(Math.max(80, Math.ceil(body.scrollHeight)));
    observerRef.current?.disconnect();
    observerRef.current = new ResizeObserver(updateHeight);
    observerRef.current.observe(body);
    updateHeight();
  };

  return (
    <iframe
      ref={iframeRef}
      className="message-card__html"
      title="Email message content"
      sandbox="allow-same-origin allow-popups"
      srcDoc={`${EMAIL_DOCUMENT_START}${message.htmlBody}${EMAIL_DOCUMENT_END}`}
      style={{ height }}
      onLoad={handleLoad}
    />
  );
}
