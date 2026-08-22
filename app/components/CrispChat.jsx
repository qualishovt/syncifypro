/**
 * components/CrispChat.jsx
 *
 * Live-chat bubble (Crisp) on every app page. Loads Crisp's client script once
 * and tags the visitor with the shop domain, so each conversation in the Crisp
 * inbox shows which store is writing. Renders nothing itself; skipped entirely
 * when no website id is configured (local dev without CRISP_WEBSITE_ID).
 */

import { useEffect } from "react";

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
  }, [websiteId, shop]);
  return null;
}
