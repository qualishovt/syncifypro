/**
 * components/CrispChat.jsx
 *
 * Live-chat bubble (Crisp) on every app page. Loads Crisp's client script once
 * and tags the visitor with the shop domain, so each conversation in the Crisp
 * inbox shows which store is writing. Renders nothing itself; skipped entirely
 * when no website id is configured (local dev without CRISP_WEBSITE_ID).
 */

import { useEffect } from "react";

// Nudge the launcher off the very corner (default is bottom:20 / right:24).
// Crisp positions it with hashed-class CSS + !important that a stylesheet can't
// beat, so we set an inline style — the only thing that reliably wins — and
// re-apply when Crisp re-renders the launcher (open/close resets it).
const OFFSET_BOTTOM = "80px";
const OFFSET_RIGHT = "30px";

function placeLauncher() {
  const el = document.querySelector('.crisp-client [data-maximized]');
  if (!el) return false;
  if (el.style.bottom !== OFFSET_BOTTOM) el.style.setProperty("bottom", OFFSET_BOTTOM, "important");
  if (el.style.right !== OFFSET_RIGHT) el.style.setProperty("right", OFFSET_RIGHT, "important");
  return true;
}

/* eslint-disable react/prop-types */
export default function CrispChat({ websiteId, shop }) {
  useEffect(() => {
    if (!websiteId || typeof window === "undefined") return;
    window.$crisp = window.$crisp || [];
    window.CRISP_WEBSITE_ID = websiteId;
    if (shop) {
      // Shown as the visitor's name + searchable session data in the inbox.
      window.$crisp.push(["set", "user:nickname", [shop]]);
      window.$crisp.push(["set", "user:company", [shop.replace(/\.myshopify\.com$/, "")]]);
      window.$crisp.push(["set", "session:data", [[["shop", shop], ["app", "SyncifyPro"]]]]);
    }
    if (!document.getElementById("crisp-client")) {
      const s = document.createElement("script");
      s.id = "crisp-client";
      s.src = "https://client.crisp.chat/l.js";
      s.async = true;
      document.head.appendChild(s);
    }

    // The launcher appears a second or two after the script loads and Crisp may
    // re-create it; a MutationObserver keeps the offset applied without a busy
    // poll. A short interval covers the initial appearance, then stops.
    const observer = new MutationObserver(() => placeLauncher());
    observer.observe(document.body, { childList: true, subtree: true });
    let tries = 0;
    const iv = setInterval(() => { if (placeLauncher() || ++tries > 40) clearInterval(iv); }, 500);
    return () => { observer.disconnect(); clearInterval(iv); };
  }, [websiteId, shop]);
  return null;
}
