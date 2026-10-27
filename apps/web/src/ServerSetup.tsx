import { useState } from "react";
import { api, API, type Project } from "./api";
import { t } from "./i18n";
export function ServerSetup({ project }: { project: Project }) {
  const [key, setKey] = useState<string>();
  const [prefix, setPrefix] = useState(project.serverKeyPrefix);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const command = "npm install ./path/to/bugradar/packages/nestjs-sdk";
  const snippet = `import { Module } from '@nestjs/common';\nimport { BugRadarModule } from '@bugradar/nestjs-sdk';\n\n@Module({\n  imports: [BugRadarModule.forRoot({\n    endpoint: '${API}/ingest/server',\n    serverKey: process.env.BUGRADAR_SERVER_KEY!,\n    environment: process.env.NODE_ENV || 'development',\n    release: '1.0.0',\n  })],\n})\nexport class AppModule {}`;
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied("Copied");
    } catch {
      setCopied("Copy unavailable; select the text");
    }
  }
  async function rotate() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ serverKey: string; serverKeyPrefix: string }>(
        `/projects/${project.id}/rotate-server-key`,
        "POST",
      );
      setKey(result.serverKey);
      setPrefix(result.serverKeyPrefix);
      setConfirm(false);
      setCopied("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel setup">
      <div className="panel-heading">
        <h2>{t("NestJS SDK")}</h2>
      </div>
      <div className="panel-body">
        <div className="notice">
          {t(
            "Server credentials are private. Store them only in backend environment variables. Never include them in browser code, VITE_ variables, or public repositories.",
          )}
        </div>
        {error && (
          <div role="alert" className="notice error">
            {t(error)}
          </div>
        )}
        {key && (
          <>
            <div role="status" className="notice success">
              {t(
                "Server credential created. Copy it now; only its hash is stored.",
              )}
            </div>
            <div className="key-display">
              <code dir="ltr">{key}</code>
              <button onClick={() => void copy(key)}>{t("Copy")}</button>
            </div>
          </>
        )}
        {prefix && (
          <p>
            {t("Credential prefix")}: <code dir="ltr">{prefix}…</code>
          </p>
        )}
        {confirm ? (
          <div className="inline">
            <p>
              {t(
                "Rotating invalidates the previous server credential immediately. Update all backend installations.",
              )}
            </p>
            <button disabled={busy} onClick={() => void rotate()}>
              {t(busy ? "Saving…" : "Confirm rotation")}
            </button>
            <button className="secondary" onClick={() => setConfirm(false)}>
              {t("Cancel")}
            </button>
          </div>
        ) : (
          <button
            disabled={busy}
            onClick={() => (prefix ? setConfirm(true) : void rotate())}
          >
            {t(
              prefix ? "Rotate server credential" : "Create server credential",
            )}
          </button>
        )}
        <h3>{t("1. Install the local SDK package")}</h3>
        <button className="secondary small" onClick={() => void copy(command)}>
          {t("Copy")}
        </button>
        <pre dir="ltr">{command}</pre>
        <h3>{t("Configure your NestJS root module")}</h3>
        <button className="secondary small" onClick={() => void copy(snippet)}>
          {t("Copy")}
        </button>
        <pre dir="ltr">{snippet}</pre>
        <p>
          {t(
            "Set BUGRADAR_SERVER_KEY on the server. The module reports unexpected and 5xx errors, excludes 4xx responses, and preserves NestJS HTTP responses.",
          )}
        </p>
        <p>
          {t(
            "For explicit reporting, inject BugRadarService and call captureException(error). Enable shutdown hooks for cleanup.",
          )}
        </p>
        {copied && <p role="status">{t(copied)}</p>}
      </div>
    </section>
  );
}
